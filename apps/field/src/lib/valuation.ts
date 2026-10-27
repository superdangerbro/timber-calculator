import { summarize, valueTree, type AreaSummary, type Scenario, type Tree, type TreeValuation } from '@timber/core';

export function safeValue(t: Tree, s: Scenario): TreeValuation {
  try {
    return valueTree(t, s);
  } catch {
    return { treeId: t.id, product: 'none', poleClass: null, volumeM3: 0, value: 0 };
  }
}

export function safeSummary(trees: Tree[], s: Scenario): AreaSummary {
  try {
    return summarize(trees, s);
  } catch {
    return {
      treeCount: trees.length,
      poleCount: 0,
      polesByClass: {},
      sawlogM3BySpecies: {},
      totalVolumeM3: 0,
      poleValue: 0,
      sawlogValue: 0,
      totalValue: 0,
      leaveTreeCount: 0,
    };
  }
}

export function sawlogM3(s: AreaSummary) {
  return Object.values(s.sawlogM3BySpecies).reduce((a, b) => a + (b ?? 0), 0);
}

export const money = (n: number) =>
  n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
