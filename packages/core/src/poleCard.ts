import type { PoleCard, PoleFault, SpeciesCode, TreeFields } from './types';
import { STUMP_HEIGHT_M, dibCm, kozakCoefficients, stemVolumeM3, totalHeightFromMerch, DEFAULT_BEC_ZONE, DEFAULT_TOP_DIB_CM } from './taper';

const IN = 2.54;
const FT = 0.3048;

export const POLE_FAULTS: { code: PoleFault; label: string; short: string }[] = [
  { code: 'damage', label: 'Damage deeper than 1"', short: 'Damage >1"' },
  { code: 'split', label: 'Splits, cracks or breaks', short: 'Split / crack' },
  { code: 'rot', label: 'Butt or top rot', short: 'Rot' },
  { code: 'barkSeam', label: 'Bark seam deeper than 2"', short: 'Bark seam >2"' },
  { code: 'knots', label: 'Spike knots, burls or bunch knots', short: 'Spike knot / burl' },
  { code: 'shake', label: 'Shake in the outer 2"', short: 'Shake' },
  { code: 'sweep', label: 'Excess sweep (fails the straight-line test)', short: 'Excess sweep' },
];

/**
 * Stella-Jones red cedar pole specifications, July 2026 (Joe's pole buyer card).
 * Diameter at 6 ft is the minimum, inches over bark; lengths are cut lengths.
 */
export const STELLA_JONES_CEDAR_2026: PoleCard = {
  name: 'Stella-Jones red cedar, July 2026',
  species: ['CW'],
  trimFt: 3,
  rows: [
    { minDiam6FtIn: 13, lengthsFt: [43, 38], minTopIn: 7 },
    { minDiam6FtIn: 14, lengthsFt: [48, 43], minTopIn: 8 },
    { minDiam6FtIn: 16, lengthsFt: [53, 48], minTopIn: 8 },
    { minDiam6FtIn: 17, lengthsFt: [58, 53], minTopIn: 9 },
    { minDiam6FtIn: 19, lengthsFt: [63, 58], minTopIn: 9 },
    { minDiam6FtIn: 20, lengthsFt: [73, 68, 63], minTopIn: 9 },
    { minDiam6FtIn: 22, lengthsFt: [88, 83, 78, 73], minTopIn: 10 },
    { minDiam6FtIn: 24, lengthsFt: [98, 93, 88, 83, 78, 73], minTopIn: 10 },
    { minDiam6FtIn: 25, lengthsFt: [103, 98, 93, 88, 83, 78, 73], minTopIn: 10 },
    { minDiam6FtIn: 26, lengthsFt: [108, 103, 98, 93, 88, 83, 78, 73], minTopIn: 10 },
    { minDiam6FtIn: 27, lengthsFt: [108, 103, 98, 93, 88, 83, 78], minTopIn: 10 },
    { minDiam6FtIn: 28, lengthsFt: [108, 103, 98, 93, 88, 83], minTopIn: 10 },
  ],
};

export function cardFor(species: SpeciesCode | undefined, cards: PoleCard[] | undefined): PoleCard | null {
  if (!species) return null;
  return (cards ?? []).find((c) => c.species.includes(species) && c.rows.length > 0) ?? null;
}

export interface CardResult {
  /** Longest cut length the stem makes under the card, or null. */
  cutLengthFt: number | null;
  /** Sold length (cut − trim). */
  poleLengthFt: number | null;
  diam6FtIn: number;
  /** Diameter over bark at the pole top, inches (for the chosen length). */
  topIn: number | null;
  /** Pole piece volume, stump to pole top, m³ inside bark. */
  poleM3: number;
  reasons: string[];
}

/**
 * Longest pole a stem makes under a buyer card. The stem's shape comes from the
 * BC Kozak taper equation for its species and BEC zone (total height worked out
 * from DBH and marketable height). Over-bark diameters above breast height scale
 * the inside-bark taper by the tree's own DBH-to-dib ratio. The butt is the stump
 * cut (30 cm); "6 ft" is measured from there, and a length fits when the
 * over-bark diameter at its top is at least the card's minimum top.
 */
export function longestPole(
  t: Pick<TreeFields, 'species' | 'dbhCm' | 'heightM'>,
  card: PoleCard,
  opts: { becZone?: string; topDibCm?: number; stumpHeightM?: number } = {},
): CardResult | null {
  if (!t.species || !t.dbhCm || !t.heightM) return null;
  const c = kozakCoefficients(t.species, opts.becZone ?? DEFAULT_BEC_ZONE);
  if (!c) return null;
  const stump = opts.stumpHeightM ?? STUMP_HEIGHT_M;
  const H = totalHeightFromMerch(c, t.dbhCm, t.heightM, opts.topDibCm ?? DEFAULT_TOP_DIB_CM);
  const barkRatio = t.dbhCm / Math.max(dibCm(c, t.dbhCm, H, 1.3), 0.1);
  const dobIn = (h: number) => (dibCm(c, t.dbhCm!, H, h) * barkRatio) / IN;
  const d6 = dobIn(stump + 6 * FT);
  const rows = [...card.rows].sort((a, b) => a.minDiam6FtIn - b.minDiam6FtIn);
  const row = [...rows].reverse().find((r) => d6 >= r.minDiam6FtIn);
  const d6r = Math.round(d6 * 10) / 10;
  if (!row) {
    return { cutLengthFt: null, poleLengthFt: null, diam6FtIn: d6r, topIn: null, poleM3: 0, reasons: [`${d6r}" at 6 ft is under the card's ${rows[0]?.minDiam6FtIn ?? '?'}" minimum`] };
  }
  for (const L of [...row.lengthsFt].sort((a, b) => b - a)) {
    const z = stump + L * FT;
    if (z >= H) continue;
    const top = dobIn(z);
    if (top >= row.minTopIn) {
      return {
        cutLengthFt: L,
        poleLengthFt: L - card.trimFt,
        diam6FtIn: d6r,
        topIn: Math.round(top * 10) / 10,
        poleM3: stemVolumeM3(c, t.dbhCm, H, z, stump),
        reasons: [],
      };
    }
  }
  const shortest = Math.min(...row.lengthsFt);
  return {
    cutLengthFt: null, poleLengthFt: null, diam6FtIn: d6r, topIn: null, poleM3: 0,
    reasons: [`${d6r}" at 6 ft needs at least a ${shortest} ft pole with a ${row.minTopIn}" top; this stem is too short`],
  };
}

/** Human labels for a tree's pole faults. */
export function poleFaultLabels(faults: PoleFault[] | undefined): string[] {
  return (faults ?? []).map((f) => POLE_FAULTS.find((x) => x.code === f)?.short ?? f);
}
