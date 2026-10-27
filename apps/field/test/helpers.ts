import { IdbStore } from '../src/platform/storage.idb';
import { TextSpeech } from '../src/platform/speech';
import { SilentTts } from '../src/platform/tts';
import { NullInterpreter } from '../src/platform/interpreter';
import { GpsTracker } from '../src/state/gps';
import { Repo } from '../src/state/repo';
import { TallyController } from '../src/state/tally';
import type { Interpreter } from '../src/platform/types';

let n = 0;
export function dbName() {
  return `test-${Date.now()}-${n++}`;
}

export async function makeRig(opts: { name?: string; interpreter?: Interpreter } = {}) {
  const name = opts.name ?? dbName();
  const store = new IdbStore(name);
  const repo = await Repo.open(store);
  const gps = new GpsTracker();
  const speech = new TextSpeech();
  const tts = new SilentTts();
  const tally = new TallyController({ speech, tts, gps, repo, interpreter: opts.interpreter ?? new NullInterpreter() });
  const fix = (lat = 50.7, lon = -120.35, accuracyM = 4) => gps.injectFix({ lat, lon, accuracyM, timestamp: Date.now() });
  return { name, store, repo, gps, speech, tts, tally, fix };
}
