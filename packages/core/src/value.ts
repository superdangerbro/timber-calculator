import type { AreaSummary, Scenario, SpeciesCode, Tree, TreeFields, TreeValuation } from './types';
import { evaluatePole } from './pole';
import { treeVolumeM3 } from './volume';

/**
 * PLACEHOLDER prices (CAD) and pole spec until Joe confirms buyer specs.
 */
export const DEFAULT_SCENARIO: Scenario = {
  id: 'default',
  name: 'Default (placeholder prices)',
  polePrices: {
    'Class 1': { perPiece: 120, perMetre: 14 },
    'Class 2': { perPiece: 95, perMetre: 12 },
    'Class 3': { perPiece: 70, perMetre: 10 },
    'Class 4': { perPiece: 50, perMetre: 8 },
  },
  sawlogPricePerM3: {
    FD: 95, LW: 90, PL: 70, SX: 75, CW: 140, PY: 80, BL: 55, HW: 60, AT: 30, EP: 30, AC: 25,
  },
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
  defectDeduction: 0.15,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

type ValuableTree = Tree | (TreeFields & { id: string; voided?: boolean });

const money = (n: number) => Math.round(n * 100) / 100;
const vol = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Value one tree under a scenario.
 * - voided, leave tree, or missing species/dbh/height -> product 'none', value 0, volume 0.
 * - sawlog value = gross volume × (1 − defectDeduction if defects recorded) × species price.
 * - pole value = perPiece + perMetre × heightM for the tree's class (only if pole-eligible).
 * - The higher of the two is chosen and reported (ties go to pole).
 * volumeM3 is the gross volume for a pole and the defect-deducted net volume for a sawlog.
 * poleClass is set only when the chosen product is 'pole'.
 */
export function valueTree(tree: ValuableTree, scenario: Scenario = DEFAULT_SCENARIO): TreeValuation {
  const none: TreeValuation = { treeId: tree.id, product: 'none', poleClass: null, volumeM3: 0, value: 0 };
  if (tree.voided || tree.leaveTree) return none;
  if (!tree.species || !tree.dbhCm || !tree.heightM) return none;

  const gross = treeVolumeM3(tree.species, tree.dbhCm, tree.heightM, scenario.volumeCoefficients);
  const deduct = tree.defects && tree.defects.trim() ? Math.min(Math.max(scenario.defectDeduction, 0), 1) : 0;
  const net = gross * (1 - deduct);
  const sawlogValue = net * (scenario.sawlogPricePerM3[tree.species] ?? 0);

  const pole = evaluatePole(tree, scenario.poleSpec);
  if (pole.eligible && pole.poleClass) {
    const p = scenario.polePrices[pole.poleClass];
    const poleValue = p ? p.perPiece + p.perMetre * tree.heightM : 0;
    if (poleValue >= sawlogValue) {
      return { treeId: tree.id, product: 'pole', poleClass: pole.poleClass, volumeM3: vol(gross), value: money(poleValue) };
    }
  }
  return { treeId: tree.id, product: 'sawlog', poleClass: null, volumeM3: vol(net), value: money(sawlogValue) };
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
    } else if (v.product === 'sawlog') {
      const sp = t.species as SpeciesCode;
      s.sawlogM3BySpecies[sp] = vol((s.sawlogM3BySpecies[sp] ?? 0) + v.volumeM3);
      s.sawlogValue += v.value;
    }
    s.totalVolumeM3 += v.volumeM3;
  }
  s.totalVolumeM3 = vol(s.totalVolumeM3);
  s.poleValue = money(s.poleValue);
  s.sawlogValue = money(s.sawlogValue);
  s.totalValue = money(s.poleValue + s.sawlogValue);
  return s;
}
