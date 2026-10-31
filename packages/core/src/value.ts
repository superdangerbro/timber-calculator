import type { AreaSummary, PoleLengthTier, Scenario, SpeciesCode, Tree, TreeFields, TreeValuation } from './types';
import { evaluatePole } from './pole';
import { STELLA_JONES_CEDAR_2026 } from './poleCard';
import { treeVolumeM3 } from './volume';

/**
 * Joe's pole buyer's prices (2026-10-31), $/m³ by pole length. Real quoted prices,
 * not estimates. Editable per scenario.
 */
export const POLE_BUYER_TIERS: PoleLengthTier[] = [
  { minFt: 35, maxFt: 40, pricePerM3: 300 },
  { minFt: 45, maxFt: 60, pricePerM3: 340 },
  { minFt: 65, maxFt: null, pricePerM3: 500 },
];

const FT_PER_M = 3.28084;

/** Pole length a stem makes: marketable height in feet, rounded down to a whole 5 ft. */
export function poleLengthFt(heightM: number): number {
  // The small epsilon keeps 19.812 m (exactly 65 ft) from flooring to 60 on float error.
  return Math.floor((heightM * FT_PER_M + 1e-6) / 5) * 5;
}

/** The band a pole length falls in, or null if it fits none (too short, or in a gap). */
export function poleTierFor(lengthFt: number, tiers: PoleLengthTier[] | undefined): PoleLengthTier | null {
  for (const t of tiers ?? []) {
    if (priceOf(t.pricePerM3) === null) continue;
    if (lengthFt >= t.minFt && (t.maxFt === null || t.maxFt === undefined || lengthFt <= t.maxFt)) return t;
  }
  return null;
}

/** "35-40 ft", "65 ft+". */
export function tierLabel(t: PoleLengthTier): string {
  return t.maxFt === null || t.maxFt === undefined ? `${t.minFt} ft+` : `${t.minFt}-${t.maxFt} ft`;
}

/**
 * Default scenario: Joe's pole buyer's $/m³ by pole length, no sawlog prices yet
 * (entered by the user, by species). The pole spec below is an editable starting
 * point, not a buyer's spec; its minimum length is 35 ft, the shortest pole bought.
 */
export const DEFAULT_SCENARIO: Scenario = {
  id: 'default',
  name: 'Pole buyer prices',
  polePricePerM3: {},
  sawlogPricePerM3: {},
  poleLengthTiers: POLE_BUYER_TIERS,
  poleSpec: {
    species: ['FD', 'LW', 'PL', 'CW'],
    minLengthM: 10.66,
    minStraightness: 4,
    minTwist: 4,
    minBranchiness: 3,
    classes: [
      { name: 'Class 1', minDbhCm: 40, minLengthM: 18 },
      { name: 'Class 2', minDbhCm: 33, minLengthM: 15 },
      { name: 'Class 3', minDbhCm: 28, minLengthM: 13 },
      { name: 'Class 4', minDbhCm: 23, minLengthM: 10.66 },
    ],
    cards: [STELLA_JONES_CEDAR_2026],
  },
  becZone: 'ICH',
  topDibCm: 15,
  defectDeduction: 0.15,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

type ValuableTree = Tree | (TreeFields & { id: string; voided?: boolean });

const money = (n: number) => Math.round(n * 100) / 100;
const vol = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Bring a stored scenario up to the current shape: $/m³ price maps always present,
 * legacy per-piece pole prices dropped (they were placeholders, never real prices).
 */
export function normalizeScenario(input: Partial<Scenario> & Record<string, unknown>): Scenario {
  const { polePrices: _legacy, ...rest } = input as Record<string, unknown>;
  const s = { ...DEFAULT_SCENARIO, ...(rest as Partial<Scenario>) };
  return {
    ...s,
    polePricePerM3: { ...(s.polePricePerM3 ?? {}) },
    poleLengthTiers: (s.poleLengthTiers ?? DEFAULT_SCENARIO.poleLengthTiers ?? []).map((t) => ({ ...t, maxFt: t.maxFt ?? null })),
    sawlogPricePerM3: { ...(s.sawlogPricePerM3 ?? {}) },
    poleSpec: s.poleSpec
      ? { ...s.poleSpec, cards: s.poleSpec.cards ?? DEFAULT_SCENARIO.poleSpec.cards }
      : DEFAULT_SCENARIO.poleSpec,
  };
}

const priceOf = (n: number | undefined) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null);

/** True when the scenario has at least one $/m³ entered. */
export function hasPrices(scenario: Scenario): boolean {
  return (
    Object.values(scenario.polePricePerM3 ?? {}).some((v) => priceOf(v) !== null) ||
    (scenario.poleLengthTiers ?? []).some((t) => priceOf(t.pricePerM3) !== null) ||
    Object.values(scenario.sawlogPricePerM3 ?? {}).some((v) => priceOf(v) !== null)
  );
}

/**
 * Value one tree under a scenario. All prices are $/m³.
 * - voided, leave tree, or missing species/dbh/height -> product 'none', value 0, volume 0.
 * - sawlog value = net volume (gross × (1 − defectDeduction) if defects recorded) × species $/m³.
 * - pole value = gross volume × pole $/m³, only for trees that pass the pole spec. The $/m³
 *   comes from the pole-length band (marketable height rounded down to 5 ft) when the
 *   scenario has bands, else from the pole class price.
 * - With bands set, a pole-spec tree too short for every band is not a sellable pole and
 *   is valued as sawlog.
 * - A pole is reported as pole unless both prices are set and sawlog pays more,
 *   so inventory shows pole candidates even before prices are entered.
 * - priced is false when the chosen product's $/m³ is not set (value is then 0).
 */
export function valueTree(tree: ValuableTree, scenario: Scenario = DEFAULT_SCENARIO): TreeValuation {
  const none: TreeValuation = { treeId: tree.id, product: 'none', poleClass: null, poleLengthFt: null, pricePerM3: null, volumeM3: 0, value: 0, priced: true };
  if (tree.voided || tree.leaveTree) return none;
  if (!tree.species || !tree.dbhCm || !tree.heightM) return none;

  const gross = treeVolumeM3(tree.species, tree.dbhCm, tree.heightM, {
    coefficients: scenario.volumeCoefficients,
    becZone: scenario.becZone,
    topDibCm: scenario.topDibCm,
  });
  const deduct = tree.defects && tree.defects.trim() ? Math.min(Math.max(scenario.defectDeduction, 0), 1) : 0;
  const net = gross * (1 - deduct);
  const sawPrice = priceOf(scenario.sawlogPricePerM3?.[tree.species]);
  const sawlogValue = net * (sawPrice ?? 0);

  const pole = evaluatePole(tree, scenario.poleSpec, { becZone: scenario.becZone, topDibCm: scenario.topDibCm });
  const useTiers = (scenario.poleLengthTiers ?? []).some((t) => priceOf(t.pricePerM3) !== null);
  if (pole.eligible && pole.poleClass) {
    const card = pole.card ?? null;
    const lengthFt = card?.poleLengthFt ?? poleLengthFt(tree.heightM);
    const tier = useTiers ? poleTierFor(lengthFt, scenario.poleLengthTiers) : null;
    if (!useTiers || tier) {
      const polePrice = tier ? tier.pricePerM3 : priceOf(scenario.polePricePerM3?.[pole.poleClass]);
      // Card species: the pole is the stump-to-pole-top piece; the rest of the
      // marketable stem above it is valued as sawlog. Others: the whole stem.
      const poleM3 = card ? Math.min(card.poleM3, gross) : gross;
      const topM3 = card ? Math.max(gross - poleM3, 0) : 0;
      const poleValue = poleM3 * (polePrice ?? 0) + topM3 * (1 - deduct) * (sawPrice ?? 0);
      const sawlogPaysMore = polePrice !== null && sawPrice !== null && sawlogValue > poleValue;
      if (!sawlogPaysMore) {
        return {
          treeId: tree.id, product: 'pole', poleClass: pole.poleClass, poleLengthFt: lengthFt, pricePerM3: polePrice,
          cutLengthFt: card?.cutLengthFt ?? null, diam6FtIn: card?.diam6FtIn ?? null,
          volumeM3: vol(poleM3), topM3: vol(topM3), value: money(poleValue), priced: polePrice !== null, notPoleReasons: [],
        };
      }
    }
  }
  const why = pole.eligible
    ? [useTiers ? `a ${pole.card?.poleLengthFt ?? poleLengthFt(tree.heightM)} ft pole is shorter than every price band` : 'sawlog pays more']
    : pole.reasons;
  return {
    treeId: tree.id, product: 'sawlog', poleClass: null, poleLengthFt: null, pricePerM3: sawPrice,
    diam6FtIn: pole.card?.diam6FtIn ?? null, volumeM3: vol(net), value: money(sawlogValue), priced: sawPrice !== null, notPoleReasons: why,
  };
}

/**
 * Totals for a set of trees. treeCount counts non-voided trees (leave trees
 * included); leaveTreeCount counts non-voided leave trees. Volumes and values
 * only include trees whose product is pole or sawlog.
 */
export function summarize(trees: ValuableTree[], scenario: Scenario = DEFAULT_SCENARIO): AreaSummary {
  const s: AreaSummary = {
    treeCount: 0,
    poleCount: 0,
    polesByClass: {},
    sawlogM3BySpecies: {},
    totalVolumeM3: 0,
    poleValue: 0,
    sawlogValue: 0,
    totalValue: 0,
    leaveTreeCount: 0,
    sawlogCount: 0,
    poleM3: 0,
    sawlogM3: 0,
    unpricedCount: 0,
  };
  for (const t of trees) {
    if (t.voided) continue;
    s.treeCount++;
    if (t.leaveTree) s.leaveTreeCount++;
    const v = valueTree(t, scenario);
    if (v.product === 'pole') {
      s.poleCount++;
      const c = v.poleClass ?? 'Unclassed';
      s.polesByClass[c] = (s.polesByClass[c] ?? 0) + 1;
      s.poleValue += v.value;
      s.poleM3 += v.volumeM3;
      if (v.topM3) {
        s.sawlogM3 += v.topM3;
        const sp = t.species as SpeciesCode;
        s.sawlogM3BySpecies[sp] = vol((s.sawlogM3BySpecies[sp] ?? 0) + v.topM3);
      }
      if (!v.priced) s.unpricedCount++;
    } else if (v.product === 'sawlog') {
      s.sawlogCount++;
      s.sawlogM3 += v.volumeM3;
      if (!v.priced) s.unpricedCount++;
      const sp = t.species as SpeciesCode;
      s.sawlogM3BySpecies[sp] = vol((s.sawlogM3BySpecies[sp] ?? 0) + v.volumeM3);
      s.sawlogValue += v.value;
    }
    s.totalVolumeM3 += v.volumeM3 + (v.topM3 ?? 0);
  }
  s.totalVolumeM3 = vol(s.totalVolumeM3);
  s.poleM3 = vol(s.poleM3);
  s.sawlogM3 = vol(s.sawlogM3);
  s.poleValue = money(s.poleValue);
  s.sawlogValue = money(s.sawlogValue);
  s.totalValue = money(s.poleValue + s.sawlogValue);
  return s;
}
