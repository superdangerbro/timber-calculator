import type { ListenHandlers, SpeechEngine, SpeechKind } from './types';

/**
 * Typed-transcript engine: "type what you'd say". Used headless, in tests and
 * whenever no recogniser exists. Also the base class: every engine accepts
 * typed text so the text box works as a fallback everywhere.
 */
export class TextSpeech implements SpeechEngine {
  readonly kind: SpeechKind = 'text';
  protected handlers: ListenHandlers | null = null;
  protected listening = false;

  async requestPermission() {
    return true;
  }
  async start(handlers: ListenHandlers, _contextualStrings: string[] = []) {
    this.handlers = handlers;
    this.listening = true;
  }
  async stop() {
    const h = this.handlers;
    this.listening = false;
    h?.onEnd?.();
  }
  isListening() {
    return this.listening;
  }
  submitText(text: string) {
    const t = text.trim();
    if (!t) return;
    const h = this.handlers;
    if (!h) return;
    h.onFinal(t);
  }
}

type WebRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

/** Web Speech API (Chrome/Safari). Falls back to typed text on error. */
export class WebSpeech extends TextSpeech {
  readonly kind: SpeechKind = 'web';
  private rec: WebRecognition | null = null;

  static supported(): boolean {
    const w = globalThis as any;
    return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
  }

  async start(handlers: ListenHandlers, _contextualStrings: string[] = []) {
    await super.start(handlers);
    const w = globalThis as any;
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;
    try {
      this.rec?.abort();
    } catch {
      /* ignore */
    }
    const rec: WebRecognition = new Ctor();
    rec.lang = 'en-CA';
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0]?.transcript ?? '';
        if (r.isFinal) handlers.onFinal(text.trim());
        else interim += text;
      }
      if (interim) handlers.onPartial?.(interim.trim());
    };
    rec.onerror = (e: any) => {
      // "no-speech" and "aborted" are normal; the typed box still works.
      if (e?.error && e.error !== 'no-speech' && e.error !== 'aborted') handlers.onError?.(`speech: ${e.error}`);
    };
    rec.onend = () => {
      // Keep the engine "listening" for typed input; only the mic stopped.
      if (this.rec === rec) this.rec = null;
    };
    this.rec = rec;
    try {
      rec.start();
    } catch (err) {
      handlers.onError?.(`speech: ${(err as Error).message}`);
    }
  }

  async stop() {
    try {
      this.rec?.stop();
    } catch {
      /* ignore */
    }
    this.rec = null;
    await super.stop();
  }
}
