import { averageFixes, type AveragedPosition, type GpsFix } from '@timber/core';
import { Emitter } from '../lib/emitter';
import { SimulatedGps } from '../platform/gps';
import type { GpsEngine, GpsWatch } from '../platform/types';

export interface GpsState {
  engine: 'native' | 'web' | 'simulated' | 'none';
  last: GpsFix | null;
  /** Fixes collected for the tree being tallied. */
  fixes: GpsFix[];
  averaged: AveragedPosition | null;
  averaging: boolean;
  error: string | null;
}

/**
 * Keeps one position watch running for the map dot, and averages fixes for
 * the current tree from the moment Talk is pressed until it is saved.
 */
export class GpsTracker extends Emitter<GpsState> {
  private watch: GpsWatch | null = null;
  private engine: GpsEngine | null = null;

  constructor() {
    super({ engine: 'none', last: null, fixes: [], averaged: null, averaging: false, error: null });
  }

  async start(engine: GpsEngine) {
    this.watch?.stop();
    this.engine = engine;
    this.setState({ engine: engine.kind, error: null });
    try {
      this.watch = await engine.watch(
        (fix) => this.onFix(fix),
        (msg) => this.setState({ error: msg }),
      );
    } catch (err) {
      this.setState({ error: (err as Error).message });
    }
  }

  stop() {
    this.watch?.stop();
    this.watch = null;
  }

  private onFix(fix: GpsFix) {
    if (!this.state.averaging) {
      this.setState({ last: fix, error: null });
      return;
    }
    const fixes = [...this.state.fixes, fix].slice(-120);
    let averaged: AveragedPosition | null = null;
    try {
      averaged = averageFixes(fixes);
    } catch {
      averaged = { lat: fix.lat, lon: fix.lon, accuracyM: fix.accuracyM, fixCount: fixes.length };
    }
    this.setState({ last: fix, fixes, averaged, error: null });
  }

  /** New tree: start averaging from scratch (the simulator also walks to a new spot). */
  beginTree() {
    const simulated = this.engine instanceof SimulatedGps;
    if (simulated) (this.engine as SimulatedGps).jump();
    // Seed with the latest fix if it is fresh, so the chip never shows "0 fixes" at a standing tree.
    const last = this.state.last;
    const seed = last && !simulated && Date.now() - last.timestamp < 15_000 ? [last] : [];
    this.setState({
      fixes: seed,
      averaged: seed.length ? { lat: seed[0].lat, lon: seed[0].lon, accuracyM: seed[0].accuracyM, fixCount: 1 } : null,
      averaging: true,
    });
  }

  /** Freeze averaging (tree saved). Returns the best position we have. */
  endTree(): AveragedPosition | null {
    const pos =
      this.state.averaged ??
      (this.state.last
        ? { lat: this.state.last.lat, lon: this.state.last.lon, accuracyM: this.state.last.accuracyM, fixCount: 1 }
        : null);
    this.setState({ averaging: false });
    return pos;
  }

  /** For tests: push a fix as if the engine reported it. */
  injectFix(fix: GpsFix) {
    this.onFix(fix);
  }
}
