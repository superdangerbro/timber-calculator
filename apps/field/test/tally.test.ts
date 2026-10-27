import { describe, expect, it, vi } from 'vitest';
import { tagSpeech, verifyChain } from '@timber/core';
import { makeRig } from './helpers';

const SENTENCE = 'big fir forty two about thirty metres straight four no twist clean';

describe('tally state machine', () => {
  it('listen -> parse -> readback -> save -> tag', async () => {
    const { tally, tts, repo, fix } = await makeRig();
    await tally.press(); // Talk / clicker
    expect(tally.getState().phase).toBe('listening');
    fix(50.7001, -120.3501, 4);
    fix(50.7002, -120.3502, 6);

    await tally.hear(SENTENCE);
    const s = tally.getState();
    expect(s.draft).toMatchObject({ species: 'FD', dbhCm: 42, heightM: 30, straightness: 4, twist: 5, branchiness: 5 });
    expect(s.phase).toBe('readback');
    expect(s.missing).toEqual([]);
    expect(tts.spoken.at(-1)).toMatch(/Douglas-fir/i);
    expect(s.spoken).toBe(tts.spoken.at(-1));

    await tally.hear('save');
    const after = tally.getState();
    expect(after.phase).toBe('saved');
    expect(after.lastTag).toBe('J-0001');
    expect(after.draft).toEqual({});
    expect(tts.spoken.at(-1)).toBe(tagSpeech('J-0001'));

    const tree = repo.getState().trees[0];
    expect(tree.tag).toBe('J-0001');
    expect(tree.species).toBe('FD');
    expect(tree.fixCount).toBe(2);
    expect(tree.lat).toBeGreaterThan(50.7);
    expect((await verifyChain(repo.getState().events.map((e) => e.event))).ok).toBe(true);
  });

  it('reads back missing fields and loops until answered', async () => {
    const { tally, tts } = await makeRig();
    await tally.press();
    await tally.hear('fir forty two');
    expect(tally.getState().missing).toEqual(expect.arrayContaining(['heightM', 'straightness', 'twist', 'branchiness']));
    expect(tts.spoken.at(-1)).toMatch(/missing/i);
    await tally.hear('thirty metres straight four twist three branchy two');
    expect(tally.getState().missing).toEqual([]);
    expect(tally.getState().draft).toMatchObject({ heightM: 30, straightness: 4, twist: 3, branchiness: 2 });
  });

  it('applies spoken corrections', async () => {
    const { tally } = await makeRig();
    await tally.press();
    await tally.hear(SENTENCE);
    await tally.hear('no, forty four');
    expect(tally.getState().draft.dbhCm).toBe(44);
    expect(tally.getState().draft.species).toBe('FD');
  });

  it('clicker press in readback saves; press after save starts the next tree', async () => {
    const { tally, repo } = await makeRig();
    await tally.press();
    await tally.hear(SENTENCE);
    expect(tally.getState().phase).toBe('readback');
    await tally.press();
    expect(tally.getState().phase).toBe('saved');
    expect(repo.getState().trees).toHaveLength(1);
    await tally.press();
    expect(tally.getState().phase).toBe('listening');
    expect(tally.getState().draft).toEqual({});
  });

  it('talking right after a save starts a new draft (zero taps)', async () => {
    const { tally, repo } = await makeRig();
    await tally.press();
    await tally.hear(SENTENCE);
    await tally.hear('save');
    await tally.hear('pine twenty eight twenty two metres straight five twist four branchy four');
    expect(tally.getState().draft.species).toBe('PL');
    await tally.hear('save');
    expect(repo.getState().trees.map((t) => t.tag).sort()).toEqual(['J-0001', 'J-0002']);
  });

  it('repeat re-speaks the tag', async () => {
    const { tally, tts } = await makeRig();
    await tally.press();
    await tally.hear(SENTENCE);
    await tally.hear('save');
    tts.spoken.length = 0;
    await tally.hear('repeat');
    expect(tts.spoken).toEqual([tagSpeech('J-0001')]);
    expect(tally.getState().phase).toBe('saved');
  });

  it('undo voids the last tree and never reuses its number', async () => {
    const { tally, repo, tts } = await makeRig();
    await tally.press();
    await tally.hear(SENTENCE);
    await tally.hear('save');
    await tally.hear(SENTENCE);
    await tally.hear('save');
    expect(tally.getState().lastTag).toBe('J-0002');
    await tally.hear('undo');
    const voided = repo.getState().trees.find((t) => t.tag === 'J-0002')!;
    expect(voided.voided).toBe(true);
    expect(tts.spoken.at(-1)).toMatch(/voided/i);
    expect(tally.getState().lastTag).toBe('J-0001');
    await tally.hear(SENTENCE);
    await tally.hear('save');
    expect(tally.getState().lastTag).toBe('J-0003');
    const events = repo.getState().events.map((e) => e.event);
    expect(events.map((e) => e.type)).toEqual(['create', 'create', 'void', 'create']);
    expect((await verifyChain(events)).ok).toBe(true);
  });

  it('leave trees use the L series', async () => {
    const { tally } = await makeRig();
    await tally.press();
    await tally.hear('leave tree fir sixty');
    expect(tally.getState().draft.leaveTree).toBe(true);
    await tally.hear('save');
    expect(tally.getState().lastTag).toBe('J-L0001');
    await tally.hear(SENTENCE);
    await tally.hear('save');
    expect(tally.getState().lastTag).toBe('J-0001');
  });

  it('typed transcripts go through the speech engine', async () => {
    const { tally } = await makeRig();
    await tally.press();
    tally.submitText(SENTENCE);
    await vi.waitFor(() => expect(tally.getState().phase).toBe('readback'));
    expect(tally.getState().draft.dbhCm).toBe(42);
  });

  it('measure height command and clinometer result', async () => {
    const { tally } = await makeRig();
    const onMeasure = vi.fn();
    tally.setOnMeasureHeight(onMeasure);
    await tally.press();
    await tally.hear('fir forty');
    await tally.hear('measure height');
    expect(onMeasure).toHaveBeenCalledOnce();
    await tally.setHeight(27.4);
    expect(tally.getState().draft).toMatchObject({ heightM: 27.4, heightSource: 'clinometer', dbhCm: 40 });
  });

  it('falls back to the interpreter when the parser is unsure', async () => {
    const interpret = vi.fn(async () => ({ species: 'CW' as const, dbhCm: 55 }));
    const { tally } = await makeRig({ interpreter: { available: true, interpret } });
    await tally.press();
    await tally.hear('uh that big red one by the creek maybe');
    expect(interpret).toHaveBeenCalled();
    expect(tally.getState().draft).toMatchObject({ species: 'CW', dbhCm: 55 });
  });

  it('nothing to save without species or dbh', async () => {
    const { tally, repo, tts } = await makeRig();
    await tally.press();
    await tally.hear('save');
    expect(repo.getState().trees).toHaveLength(0);
    expect(tts.spoken.at(-1)).toMatch(/nothing to save/i);
  });
});
