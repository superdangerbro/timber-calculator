import { SPECIES_COLORS, speciesName, type SpeciesCode, type Tree, type TreeValuation } from '@timber/core';
import { money } from './format';

export type ColorBy = 'species' | 'product' | 'value' | 'straightness' | 'twist' | 'branchiness' | 'status';

export const COLOR_BY_OPTIONS: { value: ColorBy; label: string }[] = [
  { value: 'species', label: 'Species' },
  { value: 'product', label: 'Product' },
  { value: 'value', label: 'Value' },
  { value: 'straightness', label: 'Straightness' },
  { value: 'twist', label: 'Twist' },
  { value: 'branchiness', label: 'Branchiness' },
  { value: 'status', label: 'Status' },
];

export const NA_COLOR = '#7c8a83';
export const PRODUCT_COLORS = { pole: '#fbbf24', sawlog: '#38bdf8', none: '#a8b5ae' } as const;
export const SCORE_COLORS = ['#ef4444', '#f97316', '#facc15', '#a3e635', '#22d3ee']; // 1..5, 5 best
export const STATUS_COLORS: Record<string, string> = { standing: '#e7f5ec', cut: '#94a3b8', damaged: '#f43f5e', missing: '#c084fc' };
export const VALUE_RAMP = ['#6366f1', '#22d3ee', '#a3e635', '#facc15', '#fb923c'];

export interface LegendItem { color: string; label: string; count?: number }

export interface Colorizer { color: (t: Tree) => string; legend: LegendItem[] }

export function makeColorizer(by: ColorBy, trees: Tree[], vals: Map<string, TreeValuation>): Colorizer {
  const counts = new Map<string, number>();
  const tally = (k: string) => counts.set(k, (counts.get(k) ?? 0) + 1);

  if (by === 'species') {
    for (const t of trees) tally(t.species ?? '?');
    const codes = [...counts.keys()].filter((k) => k !== '?').sort((a, b) => (counts.get(b)! - counts.get(a)!));
    return {
      color: (t) => (t.species ? SPECIES_COLORS[t.species as SpeciesCode] ?? NA_COLOR : NA_COLOR),
      legend: codes.map((c) => ({ color: SPECIES_COLORS[c as SpeciesCode], label: `${c} ${speciesName(c)}`, count: counts.get(c) })),
    };
  }
  if (by === 'product') {
    for (const t of trees) tally(vals.get(t.id)?.product ?? 'none');
    return {
      color: (t) => PRODUCT_COLORS[vals.get(t.id)?.product ?? 'none'],
      legend: [
        { color: PRODUCT_COLORS.pole, label: 'Pole', count: counts.get('pole') ?? 0 },
        { color: PRODUCT_COLORS.sawlog, label: 'Sawlog', count: counts.get('sawlog') ?? 0 },
        { color: PRODUCT_COLORS.none, label: 'None (leave / void)', count: counts.get('none') ?? 0 },
      ],
    };
  }
  if (by === 'value') {
    const values = trees.map((t) => vals.get(t.id)?.value ?? 0).filter((v) => v > 0).sort((a, b) => a - b);
    const q = (p: number) => values.length ? values[Math.min(values.length - 1, Math.floor(p * values.length))] : 0;
    const breaks = [q(0.2), q(0.4), q(0.6), q(0.8)].map((b) => Math.round(b));
    const bin = (v: number) => { let i = 0; while (i < breaks.length && v >= breaks[i]) i++; return i; };
    const legend: LegendItem[] = VALUE_RAMP.map((c, i) => ({
      color: c,
      label: i === 0 ? `< ${money(breaks[0])}` : i === 4 ? `≥ ${money(breaks[3])}` : `${money(breaks[i - 1])} – ${money(breaks[i])}`,
    }));
    legend.push({ color: NA_COLOR, label: 'No value' });
    return { color: (t) => { const v = vals.get(t.id)?.value ?? 0; return v > 0 ? VALUE_RAMP[bin(v)] : NA_COLOR; }, legend };
  }
  if (by === 'status') {
    for (const t of trees) tally(t.status);
    return {
      color: (t) => STATUS_COLORS[t.status] ?? NA_COLOR,
      legend: Object.entries(STATUS_COLORS).map(([k, c]) => ({ color: c, label: k[0].toUpperCase() + k.slice(1), count: counts.get(k) ?? 0 })),
    };
  }
  // score scales
  for (const t of trees) tally(String(t[by] ?? '?'));
  return {
    color: (t) => { const s = t[by]; return s ? SCORE_COLORS[s - 1] : NA_COLOR; },
    legend: [5, 4, 3, 2, 1].map((s) => ({ color: SCORE_COLORS[s - 1], label: `${s}${s === 5 ? ' (best)' : s === 1 ? ' (worst)' : ''}`, count: counts.get(String(s)) ?? 0 })),
  };
}
