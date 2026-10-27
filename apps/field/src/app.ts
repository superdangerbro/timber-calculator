import { createContext, useContext } from 'react';
import { SimulatedGps } from './platform/gps';
import type { Platform } from './platform/types';
import { GpsTracker } from './state/gps';
import { Repo } from './state/repo';
import { TallyController } from './state/tally';
import { SyncClient } from './sync/client';
import { registerOfflineProtocol } from './map/tiles';

export interface App {
  platform: Platform;
  repo: Repo;
  gps: GpsTracker;
  tally: TallyController;
  sync: SyncClient;
  simulator: SimulatedGps;
  /** Restart GPS with the real or simulated receiver per settings. */
  applyGpsSetting(): Promise<void>;
}

export async function createApp(platform: Platform): Promise<App> {
  const repo = await Repo.open(platform.store);
  const gps = new GpsTracker();
  const simulator = new SimulatedGps();
  const tally = new TallyController({
    speech: platform.speech,
    tts: platform.tts,
    gps,
    repo,
    interpreter: platform.interpreter,
  });
  const sync = new SyncClient(repo);
  registerOfflineProtocol(platform.store);
  const app: App = {
    platform,
    repo,
    gps,
    tally,
    sync,
    simulator,
    async applyGpsSetting() {
      await gps.start(repo.settings.simulatedGps ? simulator : platform.gps);
    },
  };
  await app.applyGpsSetting();
  sync.startAuto();
  return app;
}

export const AppContext = createContext<App | null>(null);
export function useApp(): App {
  const a = useContext(AppContext);
  if (!a) throw new Error('App not ready');
  return a;
}
