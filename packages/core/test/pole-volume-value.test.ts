import { describe, expect, it } from 'vitest';
import { DEFAULT_SCENARIO, DEFAULT_VOLUME_COEFFICIENTS, KOZAK_SPECIES_FOR, evaluatePole, hasPrices, summarize, treeVolumeM3, valueTree } from '../src';
import type { Scenario, TreeFields } from '../src';

const spec = DEFAULT_SCENARIO.poleSpec;
const good: TreeFields = { species: 'FD', dbhCm: 42, heightM: 20, straightness: 5, twist: 5, branchiness: 4 };

describe('evaluatePole', () => {
  it.each([
    [42, 20, 'Class 1'],
    [40, 18, 'Class 1'],
    [40, 17, 'Class 2'],
    [35, 16, 'Class 2'],
    [30, 14, 'Class 3'],
    [25, 12, 'Class 4'],
  ])('dbh %s height %s -> %s', (dbhCm, heightM, cls) => {
    const r = evaluatePole({ ...good, dbhCm, heightM }, spec);
    expect(r).toEqual({ eligible: true, poleClass: cls, reasons: [] });
  });
  it('too short', () => {
    const r = evaluatePole({ ...good, heightM: 11 }, spec);
    expect(r.eligible).toBe(false);
    expect(r.poleClass).toBeNull();
    expect(r.reasons.join()).toMatch(/height/);
  });
  it('too small for any class', () => {
    const r = evaluatePole({ ...good, dbhCm: 20 }, spec);
    expect(r.eligible).toBe(false);
  });
  it('wrong species, low scores, leave tree, missing data', () => {
    expect(evaluatePole({ ...good, species: 'SX' }, spec).eligible).toBe(false);
    expect(evaluatePole({ ...good, straightness: 3 }, spec).reasons).toContain('straightness 3 < 4');
    expect(evaluatePole({ ...good, twist: 3 }, spec).eligible).toBe(false);
    expect(evaluatePole({ ...good, branchiness: 2 }, spec).eligible).toBe(false);
    expect(evaluatePole({ ...good, leaveTree: true }, spec).reasons).toContain('leave tree');
    expect(evaluatePole({ species: 'FD', dbhCm: 40, heightM: 20 }, spec).eligible).toBe(false);
  });
});

describe('treeVolumeM3', () => {
  it('uses the BC Kozak taper equations: 40 cm fir, 22 m marketable height', () => {
    const v = treeVolumeM3('FD', 40, 22, { becZone: 'IDF' });
    expect(v).toBeGreaterThan(1.0);
    expect(v).toBeLessThan(1.5);
  });
  it('all species give a sane range and grow with size', () => {
    for (const code of Object.keys(KOZAK_SPECIES_FOR)) {
      const v = treeVolumeM3(code, 40, 22);
      expect(v).toBeGreaterThan(0.8);
      expect(v).toBeLessThan(1.8);
      expect(treeVolumeM3(code, 50, 22)).toBeGreaterThan(v);
      expect(treeVolumeM3(code, 40, 26)).toBeGreaterThan(v);
    }
  });
  it('BEC zone changes the answer', () => {
    expect(treeVolumeM3('PL', 30, 18, { becZone: 'SBS' })).not.toBe(treeVolumeM3('PL', 30, 18, { becZone: 'IDF' }));
  });
  it('custom coefficients and bad input', () => {
    expect(treeVolumeM3('FD', 10, 10, { coefficients: { FD: { a: 0.001, b: 1, c: 1 } } })).toBeCloseTo(0.1, 6);
    expect(DEFAULT_VOLUME_COEFFICIENTS).toEqual({});
    expect(treeVolumeM3('FD', 0, 30)).toBe(0);
    expect(treeVolumeM3(undefined, 40, 30)).toBe(0);
    expect(treeVolumeM3('ZZ', 40, 30)).toBe(0);
  });
});

const PRICED: Scenario = {
  ...DEFAULT_SCENARIO,
  polePricePerM3: { 'Class 1': 300, 'Class 2': 250, 'Class 3': 200, 'Class 4': 150 },
  sawlogPricePerM3: { FD: 95, SX: 75 },
};

describe('valueTree', () => {
  it('default scenario has no prices: pole candidates still show as poles, unpriced', () => {
    expect(hasPrices(DEFAULT_SCENARIO)).toBe(false);
    const v = valueTree({ id: 't1', ...good }, DEFAULT_SCENARIO);
    expect(v.product).toBe('pole');
    expect(v.poleClass).toBe('Class 1');
    expect(v.value).toBe(0);
    expect(v.priced).toBe(false);
    expect(v.volumeM3).toBeGreaterThan(0);
  });
  it('pole value = gross m³ × class $/m³', () => {
    const v = valueTree({ id: 't1', ...good }, PRICED);
    expect(hasPrices(PRICED)).toBe(true);
    expect(v.product).toBe('pole');
    expect(v.priced).toBe(true);
    expect(v.value).toBeCloseTo(v.volumeM3 * 300, 1);
  });
  it('picks the higher product when both are priced: sawlog wins when pole $/m³ is low', () => {
    const cheapPoles: Scenario = { ...PRICED, polePricePerM3: { 'Class 1': 1 } };
    const v = valueTree({ id: 't1', ...good }, cheapPoles);
    expect(v.product).toBe('sawlog');
    expect(v.poleClass).toBeNull();
    expect(v.value).toBeGreaterThan(1);
  });
  it('pole price missing: stays a pole candidate even if sawlog is priced', () => {
    const sawOnly: Scenario = { ...PRICED, polePricePerM3: {} };
    const v = valueTree({ id: 't1', ...good }, sawOnly);
    expect(v.product).toBe('pole');
    expect(v.priced).toBe(false);
  });
  it('non-pole species is sawlog; defects deduct volume', () => {
    const base = { id: 's', species: 'SX' as const, dbhCm: 40, heightM: 30, straightness: 5 as const, twist: 5 as const, branchiness: 5 as const };
    const clean = valueTree(base, PRICED);
    const rotten = valueTree({ ...base, defects: 'rot at the butt' }, PRICED);
    expect(clean.product).toBe('sawlog');
    expect(clean.value).toBeCloseTo(clean.volumeM3 * 75, 1);
    expect(rotten.volumeM3).toBeCloseTo(clean.volumeM3 * 0.85, 2);
    expect(rotten.value).toBeLessThan(clean.value);
  });
  it('voided, leave tree and missing data -> none', () => {
    expect(valueTree({ id: 'a', ...good, voided: true }, PRICED)).toEqual({ treeId: 'a', product: 'none', poleClass: null, volumeM3: 0, value: 0, priced: true });
    expect(valueTree({ id: 'b', ...good, leaveTree: true }, PRICED).product).toBe('none');
    expect(valueTree({ id: 'c', species: 'FD', dbhCm: 40 }, PRICED).product).toBe('none');
  });
});

describe('summarize', () => {
  const trees = [
    { id: '1', ...good }, // pole Class 1
    { id: '2', ...good, dbhCm: 30, heightM: 14 }, // pole Class 3
    { id: '3', species: 'SX' as const, dbhCm: 40, heightM: 30 }, // sawlog
    { id: '4', species: 'FD' as const, dbhCm: 40, heightM: 30, leaveTree: true },
    { id: '5', ...good, voided: true },
  ];
  it('totals with prices', () => {
    const s = summarize(trees, PRICED);
    const p1 = valueTree(trees[0], PRICED);
    const p2 = valueTree(trees[1], PRICED);
    const sx = valueTree(trees[2], PRICED);
    expect(s.treeCount).toBe(4);
    expect(s.leaveTreeCount).toBe(1);
    expect(s.poleCount).toBe(2);
    expect(s.sawlogCount).toBe(1);
    expect(s.polesByClass).toEqual({ 'Class 1': 1, 'Class 3': 1 });
    expect(s.poleValue).toBeCloseTo(p1.value + p2.value, 2);
    expect(s.poleM3).toBeCloseTo(p1.volumeM3 + p2.volumeM3, 3);
    expect(s.sawlogM3BySpecies).toEqual({ SX: sx.volumeM3 });
    expect(s.sawlogM3).toBeCloseTo(sx.volumeM3, 3);
    expect(s.sawlogValue).toBeCloseTo(sx.value, 2);
    expect(s.totalValue).toBeCloseTo(p1.value + p2.value + sx.value, 2);
    expect(s.totalVolumeM3).toBeCloseTo(p1.volumeM3 + p2.volumeM3 + sx.volumeM3, 3);
    expect(s.unpricedCount).toBe(0);
  });
  it('totals without prices count volume and products, value 0', () => {
    const s = summarize(trees, DEFAULT_SCENARIO);
    expect(s.poleCount).toBe(2);
    expect(s.sawlogCount).toBe(1);
    expect(s.totalVolumeM3).toBeGreaterThan(0);
    expect(s.totalValue).toBe(0);
    expect(s.unpricedCount).toBe(3);
  });
  it('empty', () => {
    expect(summarize([], DEFAULT_SCENARIO).totalValue).toBe(0);
  });
});
