import { describe, expect, it, vi } from 'vitest';
import { tagSpeech, verifyChain } from '@timber/core';
import { TextSpeech } from '../src/platform/speech';
import type { SpeechKind } from '../src/platform/types';
import { makeRig } from './helpers';

const SENTENCE = 'big fir forty two about thirty metres straight four no twist clean';
const FULL = { species: 'FD' as const, dbhCm: 42, heightM: 30, straightness: 4 as const, twist: 5 as const, branchiness: 5 as const };

/** A "real" microphone engine for timeout tests: never hears anything unless told to. */
class FakeMic extends TextSpeech {
  readonly kind: SpeechKind = 'native';
  partial(t: string) {
    this.handlers?.onPartial?.(t);
  }
  fail(m: string) {
    this.handlers?.onError?.(m);
  }
}

describe('tally: buttons only', () => {
  it('new tree -> pin -> form -> photo -> tag', async () => {
    const { tally, tts, repo, fix } = await makeRig();
    expect(tally.getState().step).toBe('idle');
    tally.newTree();
    expect(tally.getState()).toMatchObject({ step: 'measure', pin: { status: 'pinning' } });
    fix(50.7001, -120.3501, 4);
    fix(50.7002, -120.3502, 6);
    tally.pinNow();
    const pin = tally.getState().pin;
    expect(pin.status).toBe('pinned');
    expect(pin.position?.fixCount).toBe(2);
    // Fixes after the pin do not move the tree.
    fix(51, -121, 3);

    tally.setField(FULL);
    expect(tally.getState().missing).toEqual([]);
    tally.goPhoto();
    expect(tally.getState().step).toBe('photo');
    await tally.getTag();
    const s = tally.getState();
    expect(s.step).toBe('saved');
    expect(s.lastTag).toBe('J-0001');
    expect(s.draft).toEqual({});
    // Voice prompts are off by default: nothing is spoken.
    expect(tts.spoken).toEqual([]);

    const tree = repo.getState().trees[0];
    expect(tree).toMatchObject({ tag: 'J-0001', species: 'FD', fixCount: 2 });
    expect(tree.lat).toBeLessThan(50.71);
    expect((await verifyChain(repo.getState().events.map((e) => e.event))).ok).toBe(true);
  });

  it('pins automatically after the averaging window', async () => {
    const { tally, fix } = await makeRig({ pinMs: 6000 });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      tally.newTree();
      fix();
      vi.advanceTimersByTime(6000);
      expect(tally.getState().pin.status).toBe('pinned');
      tally.rePin();
      expect(tally.getState().pin.status).toBe('pinning');
    } finally {
      vi.useRealTimers();
    }
  });

  it('missing fields ask to confirm, then tag anyway', async () => {
    const { tally, repo } = await makeRig({ imperial: true });
    tally.newTree();
    tally.setField({ species: 'FD', circumferenceCm: 190.5, dbhCm: 60.6, heightM: 30, straightness: 4 });
    expect(tally.getState().showMissing).toBe(false);
    await tally.getTag();
    expect(tally.getState().confirmMissing).toEqual(['twist', 'branchiness']);
    expect(tally.getState().showMissing).toBe(true);
    expect(repo.getState().trees).toHaveLength(0);
    await tally.getTag(true);
    expect(tally.getState().lastTag).toBe('J-0001');
  });

  it('needs species and girth, named as circumference in circumference mode', async () => {
    const { tally, repo } = await makeRig({ imperial: true });
    tally.newTree();
    tally.setField({ species: 'FD' });
    await tally.getTag(true);
    expect(repo.getState().trees).toHaveLength(0);
    expect(tally.getState().notice).toMatch(/circumference/);
    expect(tally.getState().notice).not.toMatch(/DBH/);
  });

  it('clicker steps through the flow and never starts the mic', async () => {
    const { tally, repo } = await makeRig();
    await tally.press();
    expect(tally.getState().step).toBe('measure');
    tally.setField(FULL);
    await tally.press();
    expect(tally.getState().step).toBe('photo');
    await tally.press();
    expect(tally.getState().step).toBe('saved');
    expect(repo.getState().trees).toHaveLength(1);
    await tally.press();
    expect(tally.getState().step).toBe('measure');
    expect(tally.getState().voice).toBe(false);
    expect(tally.getState().mic).toBe('off');
  });

  it('cancel uses no number', async () => {
    const { tally } = await makeRig();
    tally.newTree();
    tally.setField({ species: 'PL', dbhCm: 30 });
    tally.cancelTree();
    expect(tally.getState().step).toBe('idle');
    tally.newTree();
    tally.setField(FULL);
    await tally.getTag();
    expect(tally.getState().lastTag).toBe('J-0001');
  });

  it('undo voids the last tree and never reuses its number', async () => {
    const { tally, repo } = await makeRig();
    for (let i = 0; i < 2; i++) {
      tally.newTree();
      tally.setField(FULL);
      await tally.getTag();
    }
    expect(tally.getState().lastTag).toBe('J-0002');
    await tally.undo();
    expect(repo.getState().trees.find((t) => t.tag === 'J-0002')!.voided).toBe(true);
    expect(tally.getState().lastTag).toBe('J-0001');
    tally.newTree();
    tally.setField(FULL);
    await tally.getTag();
    expect(tally.getState().lastTag).toBe('J-0003');
    const events = repo.getState().events.map((e) => e.event);
    expect(events.map((e) => e.type)).toEqual(['create', 'create', 'void', 'create']);
    expect((await verifyChain(events)).ok).toBe(true);
  });

  it('leave trees use the L series', async () => {
    const { tally } = await makeRig();
    tally.newTree();
    tally.setField({ species: 'FD', dbhCm: 60, leaveTree: true });
    await tally.getTag();
    expect(tally.getState().lastTag).toBe('J-L0001');
  });

  it('voice prompts setting speaks the tag without a mic', async () => {
    const { tally, tts, repo } = await makeRig();
    await repo.saveSettings({ voicePrompts: true });
    tally.newTree();
    tally.setField(FULL);
    await tally.getTag();
    expect(tts.spoken.at(-1)).toBe(tagSpeech('J-0001'));
    expect(tally.getState().mic).toBe('off');
  });

  it('clinometer sets the height', async () => {
    const { tally } = await makeRig();
    tally.newTree();
    tally.setField({ species: 'FD', dbhCm: 40 });
    await tally.setHeight(27.4);
    expect(tally.getState().draft).toMatchObject({ heightM: 27.4, heightSource: 'clinometer', dbhCm: 40 });
  });
});

describe('tally: optional voice', () => {
  it('typed transcript fills the form, reads back, and saves', async () => {
    const { tally, tts, repo } = await makeRig();
    tally.newTree();
    await tally.toggleVoice();
    expect(tally.getState()).toMatchObject({ voice: true, mic: 'listening' });
    tally.submitText(SENTENCE);
    await vi.waitFor(() => expect(tally.getState().draft).toMatchObject(FULL));
    await vi.waitFor(() => expect(tts.spoken.at(-1)).toMatch(/Douglas-fir/i));
    tally.submitText('save');
    await vi.waitFor(() => expect(tally.getState().lastTag).toBe('J-0001'));
    expect(tts.spoken).toContain(tagSpeech('J-0001'));
    expect(repo.getState().trees).toHaveLength(1);
    await tally.voiceOff();
    expect(tally.getState()).toMatchObject({ voice: false, mic: 'off' });
  });

  it('"new tree" by voice starts a tree', async () => {
    const { tally } = await makeRig();
    await tally.toggleVoice();
    await tally.hear('new tree');
    expect(tally.getState()).toMatchObject({ step: 'measure', pin: { status: 'pinning' } });
  });

  it('spoken corrections replace the last number', async () => {
    const { tally } = await makeRig();
    tally.newTree();
    await tally.hear(SENTENCE);
    await tally.hear('no, forty four');
    expect(tally.getState().draft).toMatchObject({ dbhCm: 44, species: 'FD' });
  });

  it('"save" with gaps asks again, naming circumference', async () => {
    const { tally, tts } = await makeRig({ imperial: true });
    tally.newTree();
    await tally.toggleVoice();
    await tally.hear('fir seventy five');
    await tally.hear('save');
    expect(tally.getState().confirmMissing).toEqual(expect.arrayContaining(['heightM', 'twist']));
    expect(tts.spoken.at(-1)).toMatch(/^Missing height/);
    await tally.hear('save');
    expect(tally.getState().lastTag).toBe('J-0001');
  });

  it('readback names circumference, not DBH, when it is missing', async () => {
    const { tally, tts } = await makeRig({ imperial: true });
    tally.newTree();
    await tally.toggleVoice();
    await tally.hear('fir ninety eight feet');
    expect(tts.spoken.at(-1)).toMatch(/Missing: circumference/);
  });

  it('10 s of silence drops back to the form', async () => {
    const mic = new FakeMic();
    const { tally } = await makeRig({ speech: mic });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      tally.newTree();
      tally.setField({ species: 'FD' });
      await tally.toggleVoice();
      expect(tally.getState().mic).toBe('listening');
      await vi.advanceTimersByTimeAsync(10_000);
      expect(tally.getState()).toMatchObject({ voice: false, mic: 'off', step: 'measure' });
      expect(tally.getState().notice).toMatch(/Didn't hear anything/);
      expect(tally.getState().draft.species).toBe('FD');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the live partial transcript and stops on errors', async () => {
    const mic = new FakeMic();
    const { tally } = await makeRig({ speech: mic, silenceMs: 50 });
    tally.newTree();
    await tally.toggleVoice();
    mic.partial('big fir');
    expect(tally.getState().partial).toBe('big fir');
    mic.fail('network');
    await vi.waitFor(() => expect(tally.getState().voice).toBe(false));
    expect(tally.getState().notice).toMatch(/Voice stopped: network/);
    expect(tally.getState().step).toBe('measure');
  });

  it('a failing microphone start is a notice, not a crash', async () => {
    const mic = new FakeMic();
    mic.start = async () => {
      throw new Error('plugin missing');
    };
    const { tally } = await makeRig({ speech: mic });
    tally.newTree();
    await tally.toggleVoice();
    expect(tally.getState()).toMatchObject({ voice: false, mic: 'off', step: 'measure' });
    expect(tally.getState().notice).toMatch(/plugin missing/);
  });

  it('falls back to the interpreter when the parser is unsure', async () => {
    const interpret = vi.fn(async () => ({ species: 'CW' as const, dbhCm: 55 }));
    const { tally } = await makeRig({ interpreter: { available: true, interpret } });
    tally.newTree();
    await tally.hear('uh that big red one by the creek maybe');
    expect(interpret).toHaveBeenCalled();
    expect(tally.getState().draft).toMatchObject({ species: 'CW', dbhCm: 55 });
  });

  it('repeat re-speaks the tag', async () => {
    const { tally, tts } = await makeRig();
    tally.newTree();
    tally.setField(FULL);
    await tally.getTag();
    await tally.repeat();
    expect(tts.spoken.at(-1)).toBe(tagSpeech('J-0001'));
  });
});
