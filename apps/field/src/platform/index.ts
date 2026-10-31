import { Capacitor } from '@capacitor/core';
import { NativeSpeech } from './speech.native';
import { TextSpeech, WebSpeech } from './speech';
import { NativeTts, SilentTts, WebTts } from './tts';
import { NativeGps, WebGps } from './gps';
import { NativeMotion, WebMotion } from './motion';
import { NativeInterpreter, NullInterpreter } from './interpreter';
import { IdbStore } from './storage.idb';
import { SqliteStore } from './storage.sqlite';
import type { Platform } from './types';

export * from './types';

/**
 * Picks native (Capacitor plugins) or web implementations. URL overrides for
 * desktop testing: ?speech=text forces the typed box, ?tts=silent mutes TTS.
 */
export function createPlatform(): Platform {
  const native = Capacitor.isNativePlatform();
  const params = new URLSearchParams(globalThis.location?.search ?? '');
  const speechParam = params.get('speech');
  const speech =
    speechParam === 'text'
      ? new TextSpeech()
      : native
        ? new NativeSpeech()
        : WebSpeech.supported() && speechParam !== 'text'
          ? new WebSpeech()
          : new TextSpeech();
  const tts = params.get('tts') === 'silent' ? new SilentTts() : native ? new NativeTts() : new WebTts();
  return {
    native,
    speech,
    tts,
    gps: native ? new NativeGps() : new WebGps(),
    motion: native ? new NativeMotion() : new WebMotion(),
    store: native ? new SqliteStore() : new IdbStore(),
    interpreter: native ? new NativeInterpreter() : new NullInterpreter(),
  };
}
