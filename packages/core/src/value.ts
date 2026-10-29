import type { AreaSummary, Scenario, SpeciesCode, Tree, TreeFields, TreeValuation } from './types';
import { evaluatePole } from './pole';
import { treeVolumeM3 } from './volume';

/**
 * Default scenario: no prices. Prices are $/m³ only and are entered by the user
 * (pole $/m³ by pole class, sawlog $/m³ by species). The pole spec below is an
 * editable starting point, not a buyer's spec.
 */
export const DEFAULT_SCENARIO: Scenario = {
  id: 'default',
  name: 'No prices set',
  polePricePerM3: {},
  sawlogPricePerM3: {},
  poleSpec: {
    species: ['FD', 'LW', 'PL', 'CW'],
    minLengthM: 12,
    minStraightness: 4,
    minTwist: 4,
    minBranchiness: 3,
    classes: [
      { name: 'Class 1', minDbhCm: 40, minLengthM: 18 },
      { name: 'Class 2', minDbhCm: 33, minLengthM: 15 },
      { name: 'Class 3', minDbhCm: 28, minLengthM: 13 },
      { name: 'Class 4', minDbhCm: 23, minLengthM: 12 },
    ],
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
    sawlogPricePerM3: { ...(s.sawlogPricePerM3 ?? {}) },
    poleSpec: s.poleSpec ?? DEFAULT_SCENARIO.poleSpec,
  };
}

const priceOf = (n: number | undefined) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null);

/** True when the scenario has at least one $/m³ entered. */
export function hasPrices(scenario: Scenario): boolean {
  return (
    Object.values(scenario.polePricePerM3 ?? {}).some((v) => priceOf(v) !== null) ||
    Object.values(scenario.sawlogPricePerM3 ?? {}).some((v) => priceOf(v) !== null)
  );
}

/**
 * Value one tree under a scenario. All prices are $/m³.
 * - voided, leave tree, or missing species/dbh/height -> product 'none', value 0, volume 0.
 * - sawlog value = net volume (gross × (1 − defectDeduction) if defects recorded) × species $/m³.
 * - pole value = gross volume × pole class $/m³ (only if pole-eligible).
 * - A pole-eligible tree is reported as pole unless both prices are set and sawlog pays more,
 *   so inventory shows pole candidates even before prices are entered.
 * - priced is false when the chosen product's $/m³ is not set (value is then 0).
 */
export function valueTree(tree: ValuableTree, scenario: Scenario = DEFAULT_SCENARIO): TreeValuation {
  const none: TreeValuation = { treeId: tree.id, product: 'none', poleClass: null, volumeM3: 0, value: 0, priced: true };
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

  const pole = evaluatePole(tree, scenario.poleSpec);
  if (pole.eligible && pole.poleClass) {
    const polePrice = priceOf(scenario.polePricePerM3?.[pole.poleClass]);
    const poleValue = gross * (polePrice ?? 0);
    const sawlogPaysMore = polePrice !== null && sawPrice !== null && sawlogValue > poleValue;
    if (!sawlogPaysMore) {
      return { treeId: tree.id, product: 'pole', poleClass: pole.poleClass, volumeM3: vol(gross), value: money(poleValue), priced: polePrice !== null };
    }
  }
  return { treeId: tree.id, product: 'sawlog', poleClass: null, volumeM3: vol(net), value: money(sawlogValue), priced: sawPrice !== null };
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
      if (!v.priced) s.unpricedCount++;
    } else if (v.product === 'sawlog') {
      s.sawlogCount++;
      s.sawlogM3 += v.volumeM3;
      if (!v.priced) s.unpricedCount++;
      const sp = t.species as SpeciesCode;
      s.sawlogM3BySpecies[sp] = vol((s.sawlogM3BySpecies[sp] ?? 0) + v.volumeM3);
      s.sawlogValue += v.value;
    }
    s.totalVolumeM3 += v.volumeM3;
  }
  s.totalVolumeM3 = vol(s.totalVolumeM3);
  s.poleM3 = vol(s.poleM3);
  s.sawlogM3 = vol(s.sawlogM3);
  s.poleValue = money(s.poleValue);
  s.sawlogValue = money(s.sawlogValue);
  s.totalValue = money(s.poleValue + s.sawlogValue);
  return s;
}
