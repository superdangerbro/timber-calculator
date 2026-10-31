import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import { TextSpeech } from './speech';
import type { ListenHandlers, SpeechKind } from './types';

/**
 * Our own on-device recogniser (ios-plugins/TimberAI/TimberSpeechPlugin.swift):
 * SFSpeechRecognizer with requiresOnDeviceRecognition (works with no signal)
 * and contextualStrings (species names, command words). Used when the plugin
 * is compiled into the app; otherwise we fall back to the community plugin.
 */
interface TimberSpeechPlugin {
  start(opts: { language: string; contextualStrings: string[]; onDevice: boolean }): Promise<void>;
  stop(): Promise<void>;
  requestPermissions(): Promise<{ speech: string; microphone: string }>;
  addListener(event: 'partial', fn: (d: { text: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'final', fn: (d: { text: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'error', fn: (d: { message: string }) => void): Promise<PluginListenerHandle>;
}
const TimberSpeech = registerPlugin<TimberSpeechPlugin>('TimberSpeech');

/** How long the user may pause before an utterance counts as finished. */
const SILENCE_MS = 1400;

export class NativeSpeech extends TextSpeech {
  readonly kind: SpeechKind = 'native';
  private listeners: PluginListenerHandle[] = [];
  private lastPartial = '';
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private finished = false;
  /** Prefer our TimberSpeech plugin; probed on first use, community plugin as fallback. */
  private useTimber = Capacitor.isPluginAvailable('TimberSpeech');
  private permission: Promise<boolean> | null = null;

  async requestPermission() {
    try {
      const r = await TimberSpeech.requestPermissions();
      this.useTimber = true;
      return r.speech === 'granted' && r.microphone === 'granted';
    } catch {
      this.useTimber = false; // not compiled into this build
    }
    try {
      const { available } = await SpeechRecognition.available();
      if (!available) return false;
      const r = await SpeechRecognition.requestPermissions();
      return r.speechRecognition === 'granted';
    } catch {
      return false;
    }
  }

  private async clearListeners() {
    const ls = this.listeners;
    this.listeners = [];
    await Promise.all(ls.map((l) => l.remove().catch(() => undefined)));
  }

  private finish(text: string) {
    if (this.finished) return;
    this.finished = true;
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
    const h = this.handlers;
    void this.stopMic().then(() => {
      if (text.trim()) h?.onFinal(text.trim());
      this.listening = false;
      h?.onEnd?.();
    });
  }

  private onPartial(text: string) {
    if (this.finished) return;
    this.lastPartial = text;
    this.handlers?.onPartial?.(text);
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => this.finish(this.lastPartial), SILENCE_MS);
  }

  async start(handlers: ListenHandlers, contextualStrings: string[] = []) {
    this.permission ??= this.requestPermission();
    if (!(await this.permission)) {
      this.permission = null; // ask again next time
      handlers.onError?.('Microphone or speech permission denied: Settings > Timber Tally');
      await super.start(handlers); // typed box still works
      return;
    }
    await this.stopMic();
    await super.start(handlers);
    this.lastPartial = '';
    this.finished = false;
    try {
      if (this.useTimber) {
        this.listeners.push(await TimberSpeech.addListener('partial', (d) => this.onPartial(d.text)));
        this.listeners.push(await TimberSpeech.addListener('final', (d) => this.finish(d.text)));
        this.listeners.push(
          await TimberSpeech.addListener('error', (d) => handlers.onError?.(`speech: ${d.message}`)),
        );
        await TimberSpeech.start({ language: 'en-CA', contextualStrings, onDevice: true });
      } else {
        this.listeners.push(
          await SpeechRecognition.addListener('partialResults', (d) => this.onPartial(d.matches?.[0] ?? '')),
        );
        this.listeners.push(
          await SpeechRecognition.addListener('listeningState', (d) => {
            if (d.status === 'stopped' && !this.finished) this.finish(this.lastPartial);
          }),
        );
        // The community plugin has no contextualStrings option; TimberSpeech does.
        await SpeechRecognition.start({ language: 'en-CA', maxResults: 1, partialResults: true, popup: false });
      }
    } catch (err) {
      handlers.onError?.(`speech: ${(err as Error).message ?? err}`);
    }
  }

  private async stopMic() {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
    try {
      if (this.useTimber) await TimberSpeech.stop();
      else await SpeechRecognition.stop();
    } catch {
      /* not listening */
    }
    await this.clearListeners();
  }

  /** Manual stop (clicker press while talking): what was heard so far is the utterance. */
  async stop() {
    if (this.listening && !this.finished) {
      this.finish(this.lastPartial);
      return;
    }
    await this.stopMic();
    this.listening = false;
  }
}
