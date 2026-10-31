import { TextToSpeech } from '@capacitor-community/text-to-speech';
import type { TtsEngine } from './types';

/** Rough speaking time so we never wait forever for an `end` event that never fires. */
function estimateMs(text: string, rate = 1) {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.min(15000, 800 + (words * 420) / Math.max(0.3, rate));
}

function withTimeout(p: Promise<void>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    p.then(
      () => {
        clearTimeout(t);
        resolve();
      },
      () => {
        clearTimeout(t);
        resolve();
      },
    );
  });
}

export class NativeTts implements TtsEngine {
  async speak(text: string, opts?: { rate?: number }) {
    const rate = opts?.rate ?? 1;
    await withTimeout(
      TextToSpeech.speak({ text, lang: 'en-CA', rate, pitch: 1, volume: 1, category: 'playAndRecord' }),
      estimateMs(text, rate) + 4000,
    );
  }
  async stop() {
    await TextToSpeech.stop().catch(() => undefined);
  }
}

export class WebTts implements TtsEngine {
  async speak(text: string, opts?: { rate?: number }) {
    const synth = (globalThis as any).speechSynthesis as SpeechSynthesis | undefined;
    const rate = opts?.rate ?? 1;
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return;
    const done = new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-CA';
      u.rate = rate;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      synth.cancel();
      synth.speak(u);
    });
    await withTimeout(done, estimateMs(text, rate));
  }
  async stop() {
    (globalThis as any).speechSynthesis?.cancel();
  }
}

/** No audio: used in tests and with ?tts=silent. */
export class SilentTts implements TtsEngine {
  spoken: string[] = [];
  async speak(text: string) {
    this.spoken.push(text);
  }
  async stop() {}
}
