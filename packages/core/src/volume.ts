import type { SpeciesCode } from './types';
import { kozakTreeVolume } from './taper';

export type VolumeCoefficients = { a: number; b: number; c: number };

/**
 * Optional Schumacher-Hall overrides, V(m³) = a · DBH(cm)^b · H(m)^c, for a
 * scenario that wants its own local equation for a species. Empty by default:
 * every species uses the Ministry's Kozak taper equations (see taper.ts).
 */
export const DEFAULT_VOLUME_COEFFICIENTS: Partial<Record<SpeciesCode, VolumeCoefficients>> = {};

export interface VolumeOptions {
  /** Per-species Schumacher-Hall override (e.g. a Scenario's volumeCoefficients). */
  coefficients?: Partial<Record<SpeciesCode, VolumeCoefficients>> | null;
  /** BEC zone for the Kozak equations; defaults to ICH. */
  becZone?: string | null;
  /** Marketable top, inside-bark cm; defaults to 15 (about 6 inches). */
  topDibCm?: number | null;
}

/**
 * Gross merchantable volume in m³ (rounded to 0.001), stump to marketable top,
 * from DBH and marketable height. Uses a species override from `opts.coefficients`
 * when present, otherwise the BC Kozak 2002 BEC taper equations. Returns 0 for
 * missing or non-positive inputs and unknown species.
 */
export function treeVolumeM3(
  species: SpeciesCode | string | null | undefined,
  dbhCm: number | null | undefined,
  heightM: number | null | undefined,
  opts: VolumeOptions = {},
): number {
  if (!species || !dbhCm || !heightM || !(dbhCm > 0) || !(heightM > 0)) return 0;
  const code = species.toUpperCase() as SpeciesCode;
  const k = opts.coefficients?.[code];
  let v: number;
  if (k) {
    v = k.a * Math.pow(dbhCm, k.b) * Math.pow(heightM, k.c);
  } else {
    const kz = kozakTreeVolume(code, dbhCm, heightM, {
      becZone: opts.becZone ?? undefined,
      topDibCm: opts.topDibCm ?? undefined,
    });
    v = kz ? kz.merchVolumeM3 : 0;
  }
  return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : 0;
}
