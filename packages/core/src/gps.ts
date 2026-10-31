import type { AveragedPosition, GpsFix } from './types';

/**
 * Inverse-variance weighted mean of GPS fixes (weight 1/accuracy²). Fixes worse
 * than 3× the best accuracy are dropped first. Resulting accuracy is
 * 1/sqrt(sum of weights), floored at 1 m. With no usable fixes returns
 * { lat: NaN, lon: NaN, accuracyM: Infinity, fixCount: 0 }.
 */
export function averageFixes(fixes: GpsFix[]): AveragedPosition {
  const valid = fixes.filter(
    (f) => Number.isFinite(f.lat) && Number.isFinite(f.lon) && Number.isFinite(f.accuracyM) && f.accuracyM >= 0,
  );
  if (valid.length === 0) return { lat: NaN, lon: NaN, accuracyM: Infinity, fixCount: 0 };
  const best = Math.min(...valid.map((f) => f.accuracyM));
  const kept = valid.filter((f) => f.accuracyM <= 3 * Math.max(best, 0.1));
  let sw = 0;
  let lat = 0;
  let lon = 0;
  for (const f of kept) {
    const acc = Math.max(f.accuracyM, 0.1); // guard against 0 accuracy
    const w = 1 / (acc * acc);
    sw += w;
    lat += f.lat * w;
    lon += f.lon * w;
  }
  return {
    lat: lat / sw,
    lon: lon / sw,
    accuracyM: Math.max(1, Math.round((1 / Math.sqrt(sw)) * 10) / 10),
    fixCount: kept.length,
  };
}
