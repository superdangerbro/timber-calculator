import type { SpeciesCode } from './types';
import { KOZAK_2002_COEFFICIENTS, KOZAK_BEC_ZONES, KOZAK_EQUATION_INDEX, KOZAK_SPECIES } from './kozakCoefficients';

/**
 * BC Ministry of Forests Kozak (2002) taper equations by BEC zone ("KBEC"),
 * ported from the Ministry's FAIBBase R package (Apache 2.0). Diameters in cm
 * (inside bark), heights in m. Fully offline.
 */

export type BecZone = (typeof KOZAK_BEC_ZONES)[number];
export type KozakSpecies = (typeof KOZAK_SPECIES)[number];

export const BEC_ZONES: readonly BecZone[] = KOZAK_BEC_ZONES;
/** Interior default when a scenario does not set a zone. */
export const DEFAULT_BEC_ZONE: BecZone = 'ICH';
/** Interior stump height (Interior Appraisal Manual merchantability specs), m. */
export const STUMP_HEIGHT_M = 0.3;
/** Joe's "6 inch" marketable top, as inside-bark cm. */
export const DEFAULT_TOP_DIB_CM = 15;

/** Our species codes -> the Ministry's taper species groups. */
export const KOZAK_SPECIES_FOR: Record<SpeciesCode, KozakSpecies> = {
  FD: 'F', CW: 'C', LW: 'L', PL: 'PL', PY: 'PY', SX: 'S', BL: 'B', HW: 'H', AT: 'AT', EP: 'E', AC: 'AC',
};

export type KozakCoefficients = readonly number[]; // [b1..b9, err]

/** Coefficients for a Ministry species group (or one of our codes) in a BEC zone; null if unknown. */
export function kozakCoefficients(species: string, bec: string): KozakCoefficients | null {
  const code = species.toUpperCase();
  const group = (KOZAK_SPECIES_FOR as Record<string, KozakSpecies>)[code] ?? code;
  const row = KOZAK_SPECIES.indexOf(group as KozakSpecies);
  const col = KOZAK_BEC_ZONES.indexOf(bec.toUpperCase() as BecZone);
  if (row < 0 || col < 0) return null;
  return KOZAK_2002_COEFFICIENTS[KOZAK_EQUATION_INDEX[row][col] - 1];
}

/**
 * Inside-bark diameter (cm) at height h on a tree of DBH (cm, outside bark) and
 * total height H (m). 0 at or above the tip.
 */
export function dibCm(c: KozakCoefficients, dbhCm: number, totalHeightM: number, hM: number): number {
  if (hM >= totalHeightM) return 0;
  const [b1, b2, b3, b4, b5, b6, b7, b8, b9, err] = c;
  const z = hM / totalHeightM;
  const p = 1.3 / totalHeightM;
  const q = 1 - Math.cbrt(z);
  const x = q / (1 - Math.cbrt(p));
  const ex = b4 * z ** 4 + b5 / Math.exp(dbhCm / totalHeightM) + b6 * x ** 0.1 + b7 / dbhCm + b8 * totalHeightM ** q + b9 * x;
  return err * b1 * dbhCm ** b2 * totalHeightM ** b3 * x ** ex;
}

const SLICE_M = 0.1;
const sliceArea = (dCm: number) => (Math.PI / 4) * (dCm / 100) ** 2;

/**
 * Stem volume (m³) from the stump up to `toHeightM`, summing 10 cm Smalian
 * slices the way the provincial compiler does. The last slice is shortened to
 * end exactly at `toHeightM`.
 */
export function stemVolumeM3(
  c: KozakCoefficients,
  dbhCm: number,
  totalHeightM: number,
  toHeightM: number,
  stumpHeightM = STUMP_HEIGHT_M,
): number {
  const top = Math.min(toHeightM, totalHeightM);
  let v = 0;
  let h = stumpHeightM;
  let d = dibCm(c, dbhCm, totalHeightM, h);
  while (h < top - 1e-9) {
    const next = Math.min(h + SLICE_M, top);
    const dn = dibCm(c, dbhCm, totalHeightM, next);
    v += ((sliceArea(d) + sliceArea(dn)) / 2) * (next - h);
    h = next;
    d = dn;
  }
  return v;
}

/**
 * Total height (m) such that the stem is exactly `topDibCm` inside bark at
 * `merchHeightM` above ground. Kozak needs total height but the cruiser calls
 * marketable height to a top, so we invert the taper by bisection.
 * If no total height can carry that top at that height (a small tree called
 * tall), the top drops to half the DBH.
 */
export function totalHeightFromMerch(
  c: KozakCoefficients,
  dbhCm: number,
  merchHeightM: number,
  topDibCm = DEFAULT_TOP_DIB_CM,
): number {
  const MAX_H = 200;
  const lo0 = Math.max(merchHeightM, 1.31) + 0.01;
  // dib at merchHeight rises as total height grows.
  const reachable = (top: number) => dibCm(c, dbhCm, MAX_H, merchHeightM) >= top;
  let top = topDibCm;
  if (!reachable(top)) top = Math.min(top, dbhCm / 2);
  if (!reachable(top)) return MAX_H;
  let lo = lo0;
  let hi = MAX_H;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (dibCm(c, dbhCm, mid, merchHeightM) < top) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface KozakTreeVolume {
  totalHeightM: number;
  merchHeightM: number;
  /** Stump to marketable top, m³ (inside bark). */
  merchVolumeM3: number;
  /** Ground to tip, m³ (inside bark). */
  wholeStemVolumeM3: number;
}

/**
 * Volumes for a tree from DBH and marketable height to a top diameter.
 * Returns null for unknown species/zone or non-positive inputs.
 */
export function kozakTreeVolume(
  species: string,
  dbhCm: number,
  merchHeightM: number,
  opts: { becZone?: string; topDibCm?: number; stumpHeightM?: number } = {},
): KozakTreeVolume | null {
  if (!(dbhCm > 0) || !(merchHeightM > 0)) return null;
  const c = kozakCoefficients(species, opts.becZone ?? DEFAULT_BEC_ZONE);
  if (!c) return null;
  const stump = opts.stumpHeightM ?? STUMP_HEIGHT_M;
  const H = totalHeightFromMerch(c, dbhCm, merchHeightM, opts.topDibCm ?? DEFAULT_TOP_DIB_CM);
  const merch = merchHeightM > stump ? stemVolumeM3(c, dbhCm, H, merchHeightM, stump) : 0;
  const whole = stemVolumeM3(c, dbhCm, H, H, stump) + sliceArea(dibCm(c, dbhCm, H, stump)) * stump;
  return { totalHeightM: H, merchHeightM, merchVolumeM3: merch, wholeStemVolumeM3: whole };
}
