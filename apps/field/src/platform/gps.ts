import { Geolocation } from '@capacitor/geolocation';
import type { GpsFix } from '@timber/core';
import type { GpsEngine, GpsWatch } from './types';

const OPTS = { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 };

export class NativeGps implements GpsEngine {
  readonly kind = 'native' as const;
  async watch(onFix: (f: GpsFix) => void, onError?: (m: string) => void): Promise<GpsWatch> {
    try {
      const perm = await Geolocation.checkPermissions();
      if (perm.location !== 'granted') await Geolocation.requestPermissions({ permissions: ['location'] });
    } catch {
      /* the watch below will report the error */
    }
    const id = await Geolocation.watchPosition(OPTS, (pos, err) => {
      if (err || !pos) {
        onError?.(String(err?.message ?? err ?? 'no position'));
        return;
      }
      onFix({
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracyM: pos.coords.accuracy,
        altitudeM: pos.coords.altitude ?? null,
        timestamp: pos.timestamp,
      });
    });
    return { stop: () => void Geolocation.clearWatch({ id }) };
  }
}

export class WebGps implements GpsEngine {
  readonly kind = 'web' as const;
  async watch(onFix: (f: GpsFix) => void, onError?: (m: string) => void): Promise<GpsWatch> {
    const geo = globalThis.navigator?.geolocation;
    if (!geo) {
      onError?.('Geolocation not available');
      return { stop() {} };
    }
    const id = geo.watchPosition(
      (pos) =>
        onFix({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracyM: pos.coords.accuracy,
          altitudeM: pos.coords.altitude ?? null,
          timestamp: pos.timestamp || Date.now(),
        }),
      (err) => onError?.(err.message || 'GPS error'),
      OPTS,
    );
    return { stop: () => geo.clearWatch(id) };
  }
}

/**
 * Desktop testing: a fake receiver near the CB12 block that walks ~20 m to a
 * new tree each time jump() is called and reports 3-9 m noisy fixes every second.
 */
export class SimulatedGps implements GpsEngine {
  readonly kind = 'simulated' as const;
  constructor(
    public lat = 50.7,
    public lon = -120.35,
    private intervalMs = 1000,
  ) {}
  /** Walk 12-28 m in a random direction (called when a new tree starts). */
  jump() {
    const bearing = Math.random() * 2 * Math.PI;
    const step = 12 + Math.random() * 16;
    this.lat += (step * Math.cos(bearing)) / 111320;
    this.lon += (step * Math.sin(bearing)) / (111320 * Math.cos((this.lat * Math.PI) / 180));
  }
  async watch(onFix: (f: GpsFix) => void): Promise<GpsWatch> {
    const emit = () => {
      const acc = 3 + Math.random() * 6;
      const n = () => (Math.random() - 0.5) * 2 * acc;
      onFix({
        lat: this.lat + n() / 111320,
        lon: this.lon + n() / (111320 * Math.cos((this.lat * Math.PI) / 180)),
        accuracyM: Math.round(acc * 10) / 10,
        altitudeM: 720,
        timestamp: Date.now(),
      });
    };
    emit();
    const t = setInterval(emit, this.intervalMs);
    return { stop: () => clearInterval(t) };
  }
}
