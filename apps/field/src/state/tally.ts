import {
  SPECIES,
  missingFields,
  mergeDraft,
  parseUtterance,
  readbackText,
  tagSpeech,
  type ParseResult,
  type TreeFields,
  type VoiceCommand,
} from '@timber/core';
import { Emitter } from '../lib/emitter';
import type { Interpreter, SpeechEngine, TtsEngine } from '../platform/types';
import type { GpsTracker } from './gps';
import type { Repo } from './repo';

export type TallyPhase = 'idle' | 'listening' | 'thinking' | 'readback' | 'saved';

export interface TallyState {
  phase: TallyPhase;
  draft: TreeFields;
  missing: (keyof TreeFields)[];
  /** Interim words while talking. */
  partial: string;
  /** Last full utterance heard (or typed). */
  heard: string;
  /** Last thing the app said out loud. */
  spoken: string;
  lastTag: string | null;
  lastTreeId: string | null;
  /** Short status line, e.g. "Voided J-0147". */
  notice: string | null;
  /** True while TTS is talking. */
  speaking: boolean;
}

export interface TallyDeps {
  speech: SpeechEngine;
  tts: TtsEngine;
  gps: GpsTracker;
  repo: Repo;
  interpreter: Interpreter;
  /** "measure height" voice command. */
  onMeasureHeight?: () => void;
}

const COMMAND_WORDS = [
  'save',
  'done',
  'tag it',
  'repeat',
  'say again',
  'undo',
  'undo last',
  'scratch that',
  'measure height',
  'cancel',
  'next tree',
  'new tree',
  'leave tree',
  'straight',
  'straightness',
  'twist',
  'no twist',
  'branchy',
  'limby',
  'clean',
  'dead straight',
  'rot',
  'sweep',
  'fork',
  'crook',
  'scar',
  'conk',
  'dead top',
  'broken top',
  'frost crack',
  'catface',
  'metres',
  'centimetres',
];

export function contextualStrings(): string[] {
  const words = new Set<string>(COMMAND_WORDS);
  for (const s of SPECIES ?? []) {
    words.add(s.name);
    for (const a of s.aliases) words.add(a);
  }
  return [...words];
}

function isEmpty(f: TreeFields) {
  return Object.values(f).every((v) => v === undefined || v === '' || v === false);
}

/**
 * The hands-free tally loop:
 *   press / talk -> listen -> parse (+ LLM fallback) -> merge -> read back
 *   (incl. what's missing) -> listen again ... "save" -> tag spoken + shown.
 * One clicker button drives it: idle=start, listening=done talking,
 * readback=save, saved=next tree.
 */
export class TallyController extends Emitter<TallyState> {
  /** Bumped whenever a newer action supersedes an in-flight readback/listen. */
  private turn = 0;
  private ctx = contextualStrings();

  constructor(private deps: TallyDeps) {
    const last = deps.repo.lastOwnTree();
    super({
      phase: 'idle',
      draft: {},
      missing: [],
      partial: '',
      heard: '',
      spoken: '',
      // After a restart, keep showing the last tag tallied on this phone.
      lastTag: last?.tag ?? null,
      lastTreeId: last?.id ?? null,
      notice: null,
      speaking: false,
    });
  }

  setOnMeasureHeight(fn: () => void) {
    this.deps.onMeasureHeight = fn;
  }

  private setDraft(draft: TreeFields) {
    let missing: (keyof TreeFields)[] = [];
    try {
      missing = missingFields(draft);
    } catch {
      missing = [];
    }
    this.setState({ draft, missing });
  }

  /** Talk button / Bluetooth clicker. */
  async press() {
    const { phase, draft } = this.state;
    if (phase === 'idle' || phase === 'saved') return this.begin();
    if (phase === 'readback') return this.save();
    if (phase === 'listening') {
      if (this.deps.speech.kind !== 'text' && this.deps.speech.isListening()) {
        // Done talking: the recogniser delivers the final transcript.
        await this.deps.speech.stop();
        return;
      }
      if (!isEmpty(draft)) return this.readback();
      return;
    }
  }

  /** Start a new tree: reset the draft, start GPS averaging, listen. */
  async begin() {
    this.turn++;
    this.deps.gps.beginTree();
    this.setDraft({});
    this.setState({ phase: 'listening', partial: '', heard: '', notice: null });
    await this.listen();
  }

  async listen() {
    const myTurn = this.turn;
    // readback / saved keep their phase while listening: the button means save / next tree.
    if (this.state.phase === 'idle' || this.state.phase === 'thinking') this.setState({ phase: 'listening' });
    await this.deps.speech.start(
      {
        onPartial: (t) => this.setState({ partial: t }),
        onFinal: (t) => {
          if (myTurn !== this.turn && this.deps.speech.kind !== 'text') return;
          void this.hear(t);
        },
        onError: (m) => this.setState({ notice: m }),
      },
      this.ctx,
    );
  }

  private async say(text: string) {
    this.setState({ spoken: text, speaking: true });
    const settings = this.deps.repo.settings;
    try {
      await this.deps.tts.speak(text, { rate: settings.ttsRate });
    } finally {
      this.setState({ speaking: false });
    }
  }

  /** Speak, then go back to listening (unless something newer happened meanwhile). */
  private async sayThenListen(text: string) {
    const myTurn = ++this.turn;
    if (this.deps.speech.kind !== 'text') await this.deps.speech.stop();
    await this.say(text);
    if (myTurn === this.turn) await this.listen();
  }

  /** One utterance (spoken or typed). */
  async hear(text: string) {
    const heard = text.trim();
    if (!heard) return;
    this.setState({ heard, partial: '', notice: null });
    let result: ParseResult;
    try {
      result = parseUtterance(heard);
    } catch (err) {
      this.setState({ notice: `parser: ${(err as Error).message}` });
      return;
    }
    let fields = result.fields ?? {};
    if (!result.command && result.confidence < 0.5 && this.deps.interpreter.available) {
      this.setState({ phase: 'thinking' });
      const llm = await this.deps.interpreter.interpret(heard, this.state.draft).catch(() => null);
      if (llm) fields = { ...fields, ...llm };
    }
    const hasFields = !isEmpty(fields);
    if (hasFields) {
      if (this.state.phase === 'saved' || this.state.phase === 'idle') {
        // Talking about the next tree straight after a save: zero taps.
        this.deps.gps.beginTree();
        this.setDraft({});
      }
      this.setDraft(mergeDraft(this.state.draft, fields));
    }
    if (result.command) return this.command(result.command);
    if (hasFields) return this.readback();
    return this.sayThenListen("Sorry, didn't catch that.");
  }

  async command(cmd: VoiceCommand) {
    switch (cmd) {
      case 'save':
        return this.save();
      case 'repeat':
        return this.repeat();
      case 'undo':
        return this.undo();
      case 'measure_height':
        this.turn++;
        if (this.deps.speech.kind !== 'text') await this.deps.speech.stop();
        this.deps.onMeasureHeight?.();
        return;
      case 'cancel':
        this.setDraft({});
        this.setState({ phase: 'listening' });
        return this.sayThenListen('Cancelled.');
      case 'new_tree':
        this.deps.gps.beginTree();
        this.setDraft({});
        this.setState({ phase: 'listening', notice: null });
        return this.sayThenListen('Next tree.');
    }
  }

  async readback() {
    this.setState({ phase: 'readback' });
    if (!this.deps.repo.settings.readback) {
      this.turn++;
      return this.listen();
    }
    let text: string;
    try {
      text = readbackText(this.state.draft);
    } catch {
      text = 'Got it.';
    }
    return this.sayThenListen(text);
  }

  async save() {
    const draft = this.state.draft;
    if (isEmpty(draft) || (!draft.species && draft.dbhCm === undefined)) {
      return this.sayThenListen('Nothing to save yet. Say species and diameter.');
    }
    this.turn++;
    const position = this.deps.gps.endTree();
    const tree = await this.deps.repo.createTree(draft, position);
    this.setDraft({});
    this.setState({ phase: 'saved', lastTag: tree.tag, lastTreeId: tree.id, notice: `Saved ${tree.tag}` });
    return this.sayThenListen(tagSpeech(tree.tag));
  }

  async repeat() {
    const { lastTag, phase, draft } = this.state;
    if (lastTag && (phase === 'saved' || isEmpty(draft))) {
      const keep = this.state.phase;
      await this.sayThenListen(tagSpeech(lastTag));
      if (keep === 'saved') this.setState({ phase: 'saved' });
      return;
    }
    return this.readback();
  }

  async undo() {
    const tree = this.deps.repo.lastOwnTree();
    if (!tree) return this.sayThenListen('Nothing to undo.');
    await this.deps.repo.voidTree(tree.id, 'undo');
    const next = this.deps.repo.lastOwnTree();
    this.setState({
      notice: `Voided ${tree.tag}`,
      lastTag: next?.tag ?? null,
      lastTreeId: next?.id ?? null,
    });
    return this.sayThenListen(`Voided ${tagSpeech(tree.tag).replace(/\.$/, '').replace(/^Tag/, 'tag')}. Number not reused.`);
  }

  /** Tap-to-edit fallback for a field in the draft (no readback). */
  setField(patch: TreeFields) {
    const draft = { ...this.state.draft, ...patch };
    for (const k of Object.keys(draft) as (keyof TreeFields)[]) if (draft[k] === undefined) delete draft[k];
    this.setDraft(draft);
    if (this.state.phase === 'idle' || this.state.phase === 'saved') {
      this.deps.gps.beginTree();
      this.setState({ phase: 'listening' });
    }
  }

  /** Clinometer result. */
  async setHeight(heightM: number) {
    this.setDraft(mergeDraft(this.state.draft, { heightM, heightSource: 'clinometer' }));
    if (this.state.phase === 'idle' || this.state.phase === 'saved') this.setState({ phase: 'listening' });
    return this.readback();
  }

  /** Coming back to the Tally screen: keep the loop going if a tree is in progress. */
  resume() {
    if (this.state.phase !== 'idle' && !this.deps.speech.isListening()) {
      this.turn++;
      void this.listen();
    }
  }

  /** Typed transcript ("type what you'd say"). */
  submitText(text: string) {
    if (this.deps.speech.isListening()) this.deps.speech.submitText(text);
    else void this.hear(text);
  }

  async shutdown() {
    this.turn++;
    await this.deps.speech.stop();
    await this.deps.tts.stop();
  }
}
