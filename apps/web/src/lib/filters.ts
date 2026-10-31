import type { SpeciesCode, Tree, TreeStatus, TreeValuation } from '@timber/core';

export interface Filters {
  species: SpeciesCode[]; // empty = all
  dbhMin: number | null;
  dbhMax: number | null;
  heightMin: number | null;
  heightMax: number | null;
  minStraightness: number;
  minTwist: number;
  minBranchiness: number;
  product: 'all' | 'pole' | 'sawlog' | 'none';
  poleClass: string; // '' = any
  leave: 'all' | 'only' | 'exclude';
  status: TreeStatus[]; // empty = all
  markedBy: string[]; // user ids, empty = all
  dateFrom: string; // yyyy-mm-dd
  dateTo: string;
  includeVoided: boolean;
}

export const DEFAULT_FILTERS: Filters = {
  species: [], dbhMin: null, dbhMax: null, heightMin: null, heightMax: null,
  minStraightness: 1, minTwist: 1, minBranchiness: 1, product: 'all', poleClass: '',
  leave: 'all', status: [], markedBy: [], dateFrom: '', dateTo: '', includeVoided: false,
};

export function activeFilterCount(f: Filters): number {
  let n = 0;
  for (const k of Object.keys(DEFAULT_FILTERS) as (keyof Filters)[]) {
    if (JSON.stringify(f[k]) !== JSON.stringify(DEFAULT_FILTERS[k])) n++;
  }
  return n;
}

export function passesFilters(t: Tree, v: TreeValuation | undefined, f: Filters): boolean {
  if (!f.includeVoided && t.voided) return false;
  if (f.species.length && (!t.species || !f.species.includes(t.species))) return false;
  if (f.dbhMin !== null && (t.dbhCm ?? -1) < f.dbhMin) return false;
  if (f.dbhMax !== null && (t.dbhCm ?? Infinity) > f.dbhMax) return false;
  if (f.heightMin !== null && (t.heightM ?? -1) < f.heightMin) return false;
  if (f.heightMax !== null && (t.heightM ?? Infinity) > f.heightMax) return false;
  if (f.minStraightness > 1 && (t.straightness ?? 0) < f.minStraightness) return false;
  if (f.minTwist > 1 && (t.twist ?? 0) < f.minTwist) return false;
  if (f.minBranchiness > 1 && (t.branchiness ?? 0) < f.minBranchiness) return false;
  if (f.product !== 'all' && (v?.product ?? 'none') !== f.product) return false;
  if (f.poleClass && v?.poleClass !== f.poleClass) return false;
  if (f.leave === 'only' && !t.leaveTree) return false;
  if (f.leave === 'exclude' && t.leaveTree) return false;
  if (f.status.length && !f.status.includes(t.status)) return false;
  if (f.markedBy.length && !f.markedBy.includes(t.createdBy)) return false;
  const day = t.createdAt.slice(0, 10);
  if (f.dateFrom && day < f.dateFrom) return false;
  if (f.dateTo && day > f.dateTo) return false;
  return true;
}
