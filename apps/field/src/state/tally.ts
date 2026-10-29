import {
  SPECIES,
  missingFields,
  mergeDraft,
  parseUtterance,
  readbackText,
  tagSpeech,
  type AveragedPosition,
  type ParseResult,
  type TreeFields,
  type VoiceCommand,
} from '@timber/core';
import { Emitter } from '../lib/emitter';
import type { Interpreter, SpeechEngine, TtsEngine } from '../platform/types';
import type { GpsTracker } from './gps';
import type { Repo } from './repo';

/**
 * One tree, step by step (buttons first, voice optional):
 *   idle -> "New tree" -> measure (location pins itself) -> photo -> "Get tag number" -> saved
 */
export type TallyStep = 'idle' | 'measure' | 'photo' | 'saved';
export type MicState = 'off' | 'listening' | 'thinking';

export interface PinState {
  status: 'none' | 'pinning' | 'pinned';
  /** The position that will be saved with the tree (fixed once pinned). */
  position: AveragedPosition | null;
}

/** A photo taken before the tree has its tag; attached when the tag is issued. */
export interface PendingPhoto {
  blob: Blob;
  width: number;
  height: number;
  lat: number | null;
  lon: number | null;
}

export interface TallyState {
  step: TallyStep;
  pin: PinState;
  draft: TreeFields;
  missing: (keyof TreeFields)[];
  pendingPhotos: PendingPhoto[];
  /** Highlight missing fields (after the first "Get tag number" on this tree). */
  showMissing: boolean;
  /** Set when "Get tag number" found gaps; the screen asks to confirm. */
  confirmMissing: (keyof TreeFields)[] | null;
  /** Voice is opt-in: on only after the mic button is pressed. */
  voice: boolean;
  mic: MicState;
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
  speaking: boolean;
  /** Bumped by the "photo" voice command so the screen opens the camera. */
  cameraAsk: number;
  /** Adding a photo to an already-tagged tree (from the saved screen). */
  photoRequest: PhotoRequest | null;
}

export interface PhotoRequest {
  treeId: string;
  tag: string;
}

export interface TallyDeps {
  speech: SpeechEngine;
  tts: TtsEngine;
  gps: GpsTracker;
  repo: Repo;
  interpreter: Interpreter;
  /** "measure height" voice command. */
  onMeasureHeight?: () => void;
  /** How long to average GPS before pinning (ms). Default 6 s. */
  pinMs?: number;
  /** Listening with no words heard for this long drops back to the form (ms). Default 10 s. */
  silenceMs?: number;
}

/** Field names as Joe says them ("circumference" when that is how girth is taped). */
export function missingLabel(k: keyof TreeFields, measure: 'circumference' | 'dbh' = 'circumference'): string {
  if (k === 'dbhCm') return measure === 'circumference' ? 'circumference' : 'DBH';
  if (k === 'heightM') return 'height';
  return String(k);
}

const COMMAND_WORDS = [
  'save', 'done', 'tag it', 'get tag', 'repeat', 'say again', 'undo', 'undo last', 'scratch that',
  'measure height', 'cancel', 'next tree', 'new tree', 'leave tree', 'straight', 'straightness',
  'twist', 'no twist', 'branchy', 'limby', 'clean', 'dead straight', 'rot', 'sweep', 'fork', 'crook',
  'scar', 'conk', 'dead top', 'broken top', 'frost crack', 'catface', 'metres', 'centimetres',
  'circumference', 'circ', 'inches', 'feet', 'take a photo', 'photo',
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
  return Object.values(f).every((v) => v === undefined || v === null || v === '' || v === false);
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class TallyController extends Emitter<TallyState> {
  private pinTimer: ReturnType<typeof setTimeout> | null = null;
  private pinStarted = 0;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped whenever a newer action supersedes an in-flight listen. */
  private turn = 0;
  private ctx = contextualStrings();

  constructor(private deps: TallyDeps) {
    const last = deps.repo.lastOwnTree();
    super({
      step: 'idle',
      pin: { status: 'none', position: null },
      draft: {},
      missing: [],
      pendingPhotos: [],
      showMissing: false,
      confirmMissing: null,
      voice: false,
      mic: 'off',
      partial: '',
      heard: '',
      spoken: '',
      // After a restart, keep showing the last tag tallied on this phone.
      lastTag: last?.tag ?? null,
      lastTreeId: last?.id ?? null,
      notice: null,
      speaking: false,
      cameraAsk: 0,
      photoRequest: null,
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

  // ------------------------------------------------------------ the steps

  /** Step 1: start a tree. Begins GPS averaging and pins the location after a few seconds. */
  newTree() {
    this.setDraft({});
    this.setState({ step: 'measure', pendingPhotos: [], showMissing: false, confirmMissing: null, notice: null, heard: '', partial: '', photoRequest: null });
    this.startPin();
  }

  /** Average again from now (moved to the right spot, or the first fix was poor). */
  rePin() {
    this.startPin();
  }

  private startPin() {
    this.clearPinTimer();
    this.deps.gps.beginTree();
    this.pinStarted = Date.now();
    this.setState({ pin: { status: 'pinning', position: null } });
    this.schedulePin(this.deps.pinMs ?? 6000);
  }

  private schedulePin(ms: number) {
    if (!Number.isFinite(ms)) return; // tests pin by hand
    this.pinTimer = setTimeout(() => {
      this.pinTimer = null;
      // No fix yet: keep waiting (up to 30 s) rather than pinning nothing.
      if (!this.deps.gps.getState().averaged && Date.now() - this.pinStarted < 30_000) return this.schedulePin(1000);
      this.pinNow();
    }, ms);
  }

  private clearPinTimer() {
    if (this.pinTimer) clearTimeout(this.pinTimer);
    this.pinTimer = null;
  }

  /** Freeze the averaged position; later fixes no longer move the tree. */
  pinNow() {
    if (this.state.pin.status !== 'pinning') return;
    this.clearPinTimer();
    const position = this.deps.gps.endTree();
    this.setState({
      pin: { status: 'pinned', position },
      notice: position ? null : 'No GPS fix yet. Tap Re-pin when you have one.',
    });
  }

  /** Form / editor input for the current tree. Starts a tree if none is open. */
  setField(patch: TreeFields) {
    if (this.state.step === 'idle' || this.state.step === 'saved') this.newTree();
    const draft = { ...this.state.draft, ...patch };
    for (const k of Object.keys(draft) as (keyof TreeFields)[]) if (draft[k] === undefined) delete draft[k];
    this.setDraft(draft);
    if (this.state.confirmMissing) this.setState({ confirmMissing: null });
  }

  /** Clinometer result. */
  async setHeight(heightM: number) {
    this.setField({ heightM, heightSource: 'clinometer' });
    if (this.state.voice) await this.readback();
  }

  setNotice(notice: string | null) {
    this.setState({ notice });
  }

  /** Step 2 -> 3. */
  goPhoto() {
    if (this.state.step !== 'measure') return;
    this.setState({ step: 'photo', confirmMissing: null });
  }

  /** Step 3 -> back to 2. */
  backToMeasure() {
    if (this.state.step === 'photo' || this.state.step === 'measure') this.setState({ step: 'measure', confirmMissing: null });
  }

  addPendingPhoto(p: PendingPhoto) {
    this.setState({ pendingPhotos: [...this.state.pendingPhotos, p], notice: 'Photo added' });
  }
  removePendingPhoto(i: number) {
    this.setState({ pendingPhotos: this.state.pendingPhotos.filter((_, j) => j !== i) });
  }

  /** Abandon the tree being entered (nothing is saved, no number used). */
  cancelTree() {
    this.clearPinTimer();
    if (this.deps.gps.getState().averaging) this.deps.gps.endTree();
    this.setDraft({});
    this.setState({ step: 'idle', pin: { status: 'none', position: null }, pendingPhotos: [], confirmMissing: null, notice: 'Tree cancelled' });
  }

  /**
   * Step 4: issue the tag. With gaps it asks first (confirmMissing) unless `force`.
   * Needs at least a species and a girth.
   */
  async getTag(force = false) {
    const { draft, step } = this.state;
    if (step !== 'measure' && step !== 'photo') return;
    if (!draft.species || draft.dbhCm === undefined || draft.dbhCm === null) {
      const need = this.deps.repo.settings.measure === 'circumference' ? 'species and circumference' : 'species and DBH';
      this.setState({ step: 'measure', notice: `Add ${need} first.`, confirmMissing: null, showMissing: true });
      if (this.state.voice) await this.say(`Need ${need} first.`);
      return;
    }
    const missing = this.state.missing;
    if (missing.length && !force) {
      this.setState({ confirmMissing: missing, showMissing: true });
      return;
    }
    if (this.state.pin.status === 'pinning') this.pinNow();
    const position = this.state.pin.position ?? this.deps.gps.endTree();
    const photos = this.state.pendingPhotos;
    const tree = await this.deps.repo.createTree(draft, position);
    let photoErr: string | null = null;
    for (const p of photos) {
      try {
        await this.deps.repo.addPhoto(tree.id, p);
      } catch (e) {
        photoErr = `Photo not saved: ${errText(e)}`;
      }
    }
    this.setDraft({});
    this.setState({
      step: 'saved',
      pin: { status: 'none', position: null },
      pendingPhotos: [],
      confirmMissing: null,
      lastTag: tree.tag,
      lastTreeId: tree.id,
      notice: photoErr,
    });
    if (this.speaksPrompts()) await this.say(tagSpeech(tree.tag));
  }

  /** Bluetooth clicker / Space: advance one step. Never starts the mic. */
  async press() {
    const { step, voice, mic } = this.state;
    if (voice && mic === 'listening' && this.deps.speech.kind !== 'text' && this.deps.speech.isListening()) {
      await this.safe(() => this.deps.speech.stop(), 'speech'); // "done talking"
      return;
    }
    if (step === 'idle' || step === 'saved') return this.newTree();
    if (step === 'measure') return this.goPhoto();
    if (step === 'photo') return this.getTag(this.state.confirmMissing !== null);
  }

  async undo() {
    const tree = this.deps.repo.lastOwnTree();
    if (!tree) {
      this.setState({ notice: 'Nothing to undo' });
      return;
    }
    await this.deps.repo.voidTree(tree.id, 'undo');
    const next = this.deps.repo.lastOwnTree();
    this.setState({ notice: `Voided ${tree.tag} (number not reused)`, lastTag: next?.tag ?? null, lastTreeId: next?.id ?? null });
    if (this.speaksPrompts()) await this.say(`Voided ${tagSpeech(tree.tag).replace(/\.$/, '').replace(/^Tag/, 'tag')}. Number not reused.`);
  }

  async repeat() {
    if (this.state.lastTag) await this.say(tagSpeech(this.state.lastTag));
  }

  /** Re-tag a tree whose tag clashed; show (and speak) the new tag for fresh tape. */
  async retag(treeId: string) {
    const old = this.deps.repo.tree(treeId)?.tag;
    const tree = await this.deps.repo.retag(treeId);
    this.setState({ step: 'saved', lastTag: tree.tag, lastTreeId: tree.id, notice: `Re-tagged ${old} as ${tree.tag}: put new tape on it` });
    if (this.speaksPrompts()) await this.say(`Re-tag. ${tagSpeech(tree.tag)}`);
  }

  /** Add a photo to the last tagged tree (saved screen). */
  requestPhoto(treeId?: string) {
    const id = treeId ?? this.state.lastTreeId;
    const tree = id ? this.deps.repo.tree(id) : undefined;
    if (!tree) return;
    this.setState({ photoRequest: { treeId: tree.id, tag: tree.tag } });
  }
  photoDone(saved: boolean) {
    const req = this.state.photoRequest;
    this.setState({ photoRequest: null, notice: req ? (saved ? `Photo added to ${req.tag}` : null) : null });
  }

  // ------------------------------------------------------------ voice (optional)

  private speaksPrompts() {
    return this.state.voice || !!this.deps.repo.settings.voicePrompts;
  }

  /** Run a native call; a failure becomes a notice instead of breaking the flow. */
  private async safe<T>(fn: () => Promise<T>, what: string): Promise<T | undefined> {
    try {
      return await fn();
    } catch (e) {
      this.setState({ notice: `${what}: ${errText(e)}` });
      return undefined;
    }
  }

  /** Mic button: turn voice entry on (and listen) or off. */
  async toggleVoice() {
    if (this.state.voice) return this.voiceOff();
    this.setState({ voice: true, notice: null });
    if (this.deps.speech.kind !== 'text') {
      const ok = await this.safe(() => this.deps.speech.requestPermission(), 'microphone');
      if (!ok) {
        this.setState({ voice: false, mic: 'off', notice: this.state.notice ?? 'Microphone or speech permission is off (Settings > Timber Tally).' });
        return;
      }
    }
    await this.listen();
  }

  async voiceOff(notice?: string) {
    this.turn++;
    this.clearSilence();
    if (notice) this.setState({ notice });
    this.setState({ voice: false, mic: 'off', partial: '' });
    await this.safe(() => this.deps.speech.stop(), 'speech');
    await this.safe(() => this.deps.tts.stop(), 'voice');
  }

  private async listen() {
    if (!this.state.voice) return;
    const myTurn = this.turn;
    this.setState({ mic: 'listening', partial: '' });
    this.armSilence();
    let heardSomething = false;
    const started = await this.safe(async () => {
      await this.deps.speech.start(
        {
          onPartial: (t) => {
            this.clearSilence();
            this.setState({ partial: t });
          },
          onFinal: (t) => {
            this.clearSilence();
            heardSomething = true;
            if (myTurn !== this.turn && this.deps.speech.kind !== 'text') return;
            void this.hear(t);
          },
          onError: (m) => {
            // Voice never blocks: drop back to the form with the reason.
            if (myTurn === this.turn) void this.voiceOff(`Voice stopped: ${m}`);
          },
          onEnd: () => {
            // The recogniser gave up on its own (no speech, interruption): back to the form.
            setTimeout(() => {
              if (myTurn !== this.turn || heardSomething || this.state.mic !== 'listening') return;
              if (this.deps.speech.isListening()) return;
              void this.voiceOff(this.state.partial ? undefined : "Didn't hear anything. Use the form, or press Voice to try again.");
            }, 400);
          },
        },
        this.ctx,
      );
      return true;
    }, 'speech');
    if (!started) {
      this.clearSilence();
      this.setState({ voice: false, mic: 'off' });
    }
  }

  /** No words for a while: stop listening and leave the form as it is. */
  private armSilence() {
    this.clearSilence();
    // The typed box has no microphone to time out.
    if (this.deps.speech.kind === 'text') return;
    this.silenceTimer = setTimeout(() => {
      this.silenceTimer = null;
      if (this.state.voice && this.state.mic === 'listening' && !this.state.partial) void this.voiceOff("Didn't hear anything. Use the form, or press Voice to try again.");
    }, this.deps.silenceMs ?? 10_000);
  }

  private clearSilence() {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
  }

  private async say(text: string) {
    this.setState({ spoken: text, speaking: true });
    try {
      await this.deps.tts.speak(text, { rate: this.deps.repo.settings.ttsRate });
    } catch (e) {
      this.setState({ notice: `voice: ${errText(e)}` });
    } finally {
      this.setState({ speaking: false });
    }
  }

  /** Speak, then (in a voice session) listen again unless something newer happened. */
  private async sayThenListen(text: string) {
    const myTurn = ++this.turn;
    if (this.state.voice && this.deps.speech.kind !== 'text') await this.safe(() => this.deps.speech.stop(), 'speech');
    await this.say(text);
    if (myTurn === this.turn && this.state.voice) await this.listen();
  }

  private async readback() {
    let text: string;
    try {
      const st = this.deps.repo.settings;
      text = readbackText(this.state.draft, { units: st.units, measure: st.measure });
    } catch {
      text = 'Got it.';
    }
    return this.sayThenListen(text);
  }

  /** One utterance (spoken, or typed in the voice box). */
  async hear(text: string) {
    const heard = text.trim();
    if (!heard) return;
    this.setState({ heard, partial: '', notice: null });
    let result: ParseResult;
    try {
      const st = this.deps.repo.settings;
      result = parseUtterance(heard, { units: st.units, measure: st.measure });
    } catch (err) {
      this.setState({ notice: `parser: ${errText(err)}` });
      return;
    }
    let fields = result.fields ?? {};
    if (!result.command && result.confidence < 0.5 && this.deps.interpreter.available) {
      this.setState({ mic: 'thinking' });
      const llm = await this.deps.interpreter.interpret(heard, this.state.draft).catch(() => null);
      if (llm) fields = { ...fields, ...llm };
      if (this.state.voice) this.setState({ mic: 'listening' });
    }
    const hasFields = !isEmpty(fields);
    if (result.command === 'new_tree') return this.command('new_tree');
    if (hasFields) {
      if (this.state.step === 'idle' || this.state.step === 'saved') this.newTree();
      this.setDraft(mergeDraft(this.state.draft, fields));
      if (this.state.confirmMissing) this.setState({ confirmMissing: null });
    }
    if (result.command) return this.command(result.command);
    if (hasFields) return this.state.voice ? this.readback() : undefined;
    if (this.state.voice) return this.sayThenListen("Sorry, didn't catch that.");
  }

  async command(cmd: VoiceCommand) {
    switch (cmd) {
      case 'new_tree':
        this.newTree();
        return this.state.voice ? this.sayThenListen('New tree.') : undefined;
      case 'save':
        await this.getTag(this.state.confirmMissing !== null);
        if (this.state.confirmMissing) {
          const names = this.state.confirmMissing.map((k) => missingLabel(k, this.deps.repo.settings.measure)).join(', ');
          return this.state.voice ? this.sayThenListen(`Missing ${names}. Say save again to tag anyway.`) : undefined;
        }
        return this.state.voice ? this.listen() : undefined;
      case 'repeat':
        if (this.state.step === 'saved' || this.state.step === 'idle') return this.sayThenListen(this.state.lastTag ? tagSpeech(this.state.lastTag) : 'No tag yet.');
        return this.readback();
      case 'undo':
        await this.undo();
        return this.state.voice ? this.listen() : undefined;
      case 'measure_height':
        this.turn++;
        if (this.deps.speech.kind !== 'text') await this.safe(() => this.deps.speech.stop(), 'speech');
        this.deps.onMeasureHeight?.();
        return;
      case 'cancel':
        this.cancelTree();
        return this.state.voice ? this.sayThenListen('Cancelled.') : undefined;
      case 'photo':
        if (this.state.step === 'measure' || this.state.step === 'photo') {
          this.setState({ step: 'photo', cameraAsk: this.state.cameraAsk + 1 });
          return;
        }
        this.requestPhoto();
        return;
    }
  }

  /** Back on the Tally screen: only a voice session the user turned on resumes listening. */
  resume() {
    if (this.state.voice && !this.deps.speech.isListening()) {
      this.turn++;
      void this.listen();
    }
  }

  /** Typed transcript (voice box). */
  submitText(text: string) {
    if (this.deps.speech.isListening()) this.deps.speech.submitText(text);
    else void this.hear(text);
  }

  async shutdown() {
    this.turn++;
    this.clearPinTimer();
    this.clearSilence();
    await this.safe(() => this.deps.speech.stop(), 'speech');
    await this.safe(() => this.deps.tts.stop(), 'voice');
  }
}
