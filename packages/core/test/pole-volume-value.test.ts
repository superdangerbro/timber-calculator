import { describe, expect, it } from 'vitest';
import { DEFAULT_SCENARIO, DEFAULT_VOLUME_COEFFICIENTS, evaluatePole, summarize, treeVolumeM3, valueTree } from '../src';
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
  it('40 cm, 30 m fir is ~1.6-1.9 m³', () => {
    const v = treeVolumeM3('FD', 40, 30);
    expect(v).toBeGreaterThan(1.6);
    expect(v).toBeLessThan(1.9);
  });
  it('all species give a sane range and grow with size', () => {
    for (const code of Object.keys(DEFAULT_VOLUME_COEFFICIENTS)) {
      const v = treeVolumeM3(code, 40, 30);
      expect(v).toBeGreaterThan(1.2);
      expect(v).toBeLessThan(2.2);
      expect(treeVolumeM3(code, 50, 30)).toBeGreaterThan(v);
      expect(treeVolumeM3(code, 40, 35)).toBeGreaterThan(v);
    }
  });
  it('custom coefficients and bad input', () => {
    expect(treeVolumeM3('FD', 10, 10, { FD: { a: 0.001, b: 1, c: 1 } })).toBeCloseTo(0.1, 6);
    expect(treeVolumeM3('FD', 0, 30)).toBe(0);
    expect(treeVolumeM3(undefined, 40, 30)).toBe(0);
  });
});

describe('valueTree', () => {
  it('pole-eligible tree is a pole when the pole is worth more', () => {
    const v = valueTree({ id: 't1', ...good }, DEFAULT_SCENARIO);
    // Class 1: 120 + 14 * 20 = 400; sawlog ~ 1.2 m³ * 95 ≈ 115
    expect(v.product).toBe('pole');
    expect(v.poleClass).toBe('Class 1');
    expect(v.value).toBe(400);
    expect(v.volumeM3).toBeGreaterThan(0);
  });
  it('picks the higher product: sawlog wins when pole prices are low', () => {
    const cheapPoles: Scenario = {
      ...DEFAULT_SCENARIO,
      polePrices: { 'Class 1': { perPiece: 1, perMetre: 0 } },
    };
    const v = valueTree({ id: 't1', ...good }, cheapPoles);
    expect(v.product).toBe('sawlog');
    expect(v.poleClass).toBeNull();
    expect(v.value).toBeGreaterThan(1);
  });
  it('non-pole species is sawlog; defects deduct volume', () => {
    const base = { id: 's', species: 'SX' as const, dbhCm: 40, heightM: 30, straightness: 5 as const, twist: 5 as const, branchiness: 5 as const };
    const clean = valueTree(base, DEFAULT_SCENARIO);
    const rotten = valueTree({ ...base, defects: 'rot at the butt' }, DEFAULT_SCENARIO);
    expect(clean.product).toBe('sawlog');
    expect(clean.value).toBeCloseTo(clean.volumeM3 * 75, 1);
    expect(rotten.volumeM3).toBeCloseTo(clean.volumeM3 * 0.85, 2);
    expect(rotten.value).toBeLessThan(clean.value);
  });
  it('voided, leave tree and missing data -> none', () => {
    expect(valueTree({ id: 'a', ...good, voided: true }, DEFAULT_SCENARIO)).toEqual({ treeId: 'a', product: 'none', poleClass: null, volumeM3: 0, value: 0 });
    expect(valueTree({ id: 'b', ...good, leaveTree: true }, DEFAULT_SCENARIO).product).toBe('none');
    expect(valueTree({ id: 'c', species: 'FD', dbhCm: 40 }, DEFAULT_SCENARIO).product).toBe('none');
  });
});

describe('summarize', () => {
  it('totals', () => {
    const trees = [
      { id: '1', ...good }, // pole Class 1, 400
      { id: '2', ...good, dbhCm: 30, heightM: 14 }, // pole Class 3, 70 + 140 = 210
      { id: '3', species: 'SX' as const, dbhCm: 40, heightM: 30 }, // sawlog
      { id: '4', species: 'FD' as const, dbhCm: 40, heightM: 30, leaveTree: true },
      { id: '5', ...good, voided: true },
    ];
    const s = summarize(trees, DEFAULT_SCENARIO);
    const sx = valueTree(trees[2], DEFAULT_SCENARIO);
    expect(s.treeCount).toBe(4);
    expect(s.leaveTreeCount).toBe(1);
    expect(s.poleCount).toBe(2);
    expect(s.polesByClass).toEqual({ 'Class 1': 1, 'Class 3': 1 });
    expect(s.poleValue).toBe(610);
    expect(s.sawlogM3BySpecies).toEqual({ SX: sx.volumeM3 });
    expect(s.sawlogValue).toBeCloseTo(sx.value, 2);
    expect(s.totalValue).toBeCloseTo(610 + sx.value, 2);
    const vol = valueTree(trees[0], DEFAULT_SCENARIO).volumeM3 + valueTree(trees[1], DEFAULT_SCENARIO).volumeM3 + sx.volumeM3;
    expect(s.totalVolumeM3).toBeCloseTo(vol, 3);
  });
  it('empty', () => {
    expect(summarize([], DEFAULT_SCENARIO).totalValue).toBe(0);
  });
});
