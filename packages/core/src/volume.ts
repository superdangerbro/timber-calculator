import type { SpeciesCode } from './types';

export type VolumeCoefficients = { a: number; b: number; c: number };

/**
 * PLACEHOLDER Schumacher-Hall coefficients, V(m³) = a · DBH(cm)^b · H(m)^c.
 *
 * These are NOT the BC Ministry taper/volume equations. They were tuned so that a
 * 40 cm, 30 m Douglas-fir comes out around 1.75 m³ (other species scaled by a
 * rough form factor). Replace with the confirmed BC equations (or per-scenario
 * `volumeCoefficients`) before using numbers for anything that matters.
 */
export const DEFAULT_VOLUME_COEFFICIENTS: Record<SpeciesCode, VolumeCoefficients> = {
  FD: { a: 5.2421e-5, b: 1.92, c: 0.98 },
  LW: { a: 5.1522e-5, b: 1.92, c: 0.98 },
  PL: { a: 5.0324e-5, b: 1.92, c: 0.98 },
  PY: { a: 4.8527e-5, b: 1.92, c: 0.98 },
  SX: { a: 5.0923e-5, b: 1.92, c: 0.98 },
  BL: { a: 4.7928e-5, b: 1.92, c: 0.98 },
  HW: { a: 5.0324e-5, b: 1.92, c: 0.98 },
  CW: { a: 4.5531e-5, b: 1.92, c: 0.98 },
  AT: { a: 4.4932e-5, b: 1.92, c: 0.98 },
  EP: { a: 4.2536e-5, b: 1.92, c: 0.98 },
  AC: { a: 4.643e-5, b: 1.92, c: 0.98 },
};

/**
 * Gross tree volume in m³ (rounded to 0.001). Returns 0 for missing or
 * non-positive inputs. `coeffs` (e.g. a Scenario's volumeCoefficients)
 * overrides the defaults per species.
 */
export function treeVolumeM3(
  species: SpeciesCode | string | null | undefined,
  dbhCm: number | null | undefined,
  heightM: number | null | undefined,
  coeffs?: Partial<Record<SpeciesCode, VolumeCoefficients>> | null,
): number {
  if (!species || !dbhCm || !heightM || !(dbhCm > 0) || !(heightM > 0)) return 0;
  const code = species.toUpperCase() as SpeciesCode;
  const k = coeffs?.[code] ?? DEFAULT_VOLUME_COEFFICIENTS[code];
  if (!k) return 0;
  const v = k.a * Math.pow(dbhCm, k.b) * Math.pow(heightM, k.c);
  return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : 0;
}
