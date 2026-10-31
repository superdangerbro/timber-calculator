import { describe, expect, it } from 'vitest';
import { DEFAULT_SCENARIO, DEFAULT_VOLUME_COEFFICIENTS, KOZAK_SPECIES_FOR, POLE_BUYER_TIERS, STELLA_JONES_CEDAR_2026, longestPole, evaluatePole, hasPrices, normalizeScenario, poleLengthFt, poleTierFor, summarize, tierLabel, treeVolumeM3, valueTree } from '../src';
import type { Scenario, TreeFields } from '../src';
import { mergeDraft, parseUtterance } from '../src';

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
    const r = evaluatePole({ ...good, heightM: 10 }, spec);
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

/** No prices at all (no length bands, no class or sawlog prices). */
const NO_PRICES: Scenario = { ...DEFAULT_SCENARIO, poleLengthTiers: [] };

/** Class-priced scenario (no length bands), for the class fallback path. */
const PRICED: Scenario = {
  ...DEFAULT_SCENARIO,
  poleLengthTiers: [],
  polePricePerM3: { 'Class 1': 300, 'Class 2': 250, 'Class 3': 200, 'Class 4': 150 },
  sawlogPricePerM3: { FD: 95, SX: 75 },
};

describe('valueTree', () => {
  it('no prices: pole candidates still show as poles, unpriced', () => {
    expect(hasPrices(NO_PRICES)).toBe(false);
    const v = valueTree({ id: 't1', ...good }, NO_PRICES);
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
    expect(valueTree({ id: 'a', ...good, voided: true }, PRICED)).toEqual({ treeId: 'a', product: 'none', poleClass: null, poleLengthFt: null, pricePerM3: null, volumeM3: 0, value: 0, priced: true });
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
    const s = summarize(trees, NO_PRICES);
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

describe('pole price by length (Joe\'s pole buyer)', () => {
  const FT = 0.3048;
  const pole = (ft: number, extra: Partial<TreeFields> = {}) =>
    ({ id: `p${ft}`, species: 'FD' as const, dbhCm: 61, heightM: ft * FT, straightness: 5 as const, twist: 5 as const, branchiness: 4 as const, ...extra });

  it('default scenario carries the buyer bands: 35-40 ft $300, 45-60 ft $340, 65 ft+ $500', () => {
    expect(DEFAULT_SCENARIO.poleLengthTiers).toEqual(POLE_BUYER_TIERS);
    expect(POLE_BUYER_TIERS.map(tierLabel)).toEqual(['35-40 ft', '45-60 ft', '65 ft+']);
    expect(POLE_BUYER_TIERS.map((t) => t.pricePerM3)).toEqual([300, 340, 500]);
    expect(hasPrices(DEFAULT_SCENARIO)).toBe(true);
  });

  it.each([
    [34.9, 30], [35, 35], [39.9, 35], [44.9, 40], [45, 45], [63, 60], [64.99, 60], [65, 65], [80, 80], [100, 100],
  ])('%s ft marketable height -> %s ft pole', (h, l) => {
    expect(poleLengthFt(h * FT)).toBe(l);
  });

  it.each([
    [35, 300], [40, 300], [45, 340], [50, 340], [60, 340], [65, 500], [80, 500], [100, 500],
  ])('%s ft pole -> $%s/m³', (ft, price) => {
    const v = valueTree(pole(ft), DEFAULT_SCENARIO);
    expect(v.product).toBe('pole');
    expect(v.poleLengthFt).toBe(ft);
    expect(v.pricePerM3).toBe(price);
    expect(v.priced).toBe(true);
    expect(v.value).toBeCloseTo(v.volumeM3 * price, 1);
  });

  it('a 63 ft stem is a 60 ft pole at $340, a 66 ft stem a 65 ft pole at $500', () => {
    expect(valueTree(pole(63), DEFAULT_SCENARIO).pricePerM3).toBe(340);
    expect(valueTree(pole(66), DEFAULT_SCENARIO).pricePerM3).toBe(500);
  });

  it('too short for any band falls back to sawlog $/m³', () => {
    const withSaw: Scenario = { ...DEFAULT_SCENARIO, sawlogPricePerM3: { FD: 200 } };
    // 34 ft passes a looser spec but is under the shortest 35 ft band.
    const loose: Scenario = { ...withSaw, poleSpec: { ...withSaw.poleSpec, minLengthM: 9, classes: withSaw.poleSpec.classes.map((c) => ({ ...c, minLengthM: 9 })) } };
    for (const [ft, sc] of [[32, withSaw], [34, loose]] as const) {
      const v = valueTree(pole(ft), sc);
      expect(v.product).toBe('sawlog');
      expect(v.pricePerM3).toBe(200);
      expect(v.value).toBeCloseTo(v.volumeM3 * 200, 1);
    }
    // No sawlog price either: sawlog, unpriced.
    const v = valueTree(pole(32), DEFAULT_SCENARIO);
    expect(v.product).toBe('sawlog');
    expect(v.priced).toBe(false);
  });

  it('a gap between bands (e.g. a band starting at 45 and nothing at 40) is sawlog', () => {
    const s: Scenario = { ...DEFAULT_SCENARIO, poleLengthTiers: [{ minFt: 45, maxFt: null, pricePerM3: 340 }], sawlogPricePerM3: { FD: 200 } };
    expect(valueTree(pole(43), s).product).toBe('sawlog');
    expect(valueTree(pole(46), s).product).toBe('pole');
  });

  it('trees failing the pole spec are sawlog whatever their length', () => {
    const v = valueTree(pole(80, { straightness: 2 }), { ...DEFAULT_SCENARIO, sawlogPricePerM3: { FD: 200 } });
    expect(v.product).toBe('sawlog');
    expect(v.pricePerM3).toBe(200);
  });

  it('bands win over class prices; bands are editable', () => {
    const s: Scenario = {
      ...DEFAULT_SCENARIO,
      polePricePerM3: { 'Class 1': 1 },
      poleLengthTiers: [{ minFt: 30, maxFt: null, pricePerM3: 410 }],
    };
    const v = valueTree(pole(50), s);
    expect(v.product).toBe('pole');
    expect(v.pricePerM3).toBe(410);
  });

  it('a band with no price is skipped', () => {
    expect(poleTierFor(70, [{ minFt: 65, maxFt: null, pricePerM3: 0 }])).toBeNull();
  });

  it('old stored scenarios pick up the buyer bands; saved bands are kept', () => {
    expect(normalizeScenario({ name: 'old' }).poleLengthTiers).toEqual(POLE_BUYER_TIERS);
    const mine = [{ minFt: 40, maxFt: null, pricePerM3: 450 }];
    expect(normalizeScenario({ name: 'mine', poleLengthTiers: mine }).poleLengthTiers).toEqual(mine);
  });

  it('Joe\'s typical 2 ft DBH cedar, 70 ft: 65 ft+ band at $500/m³', () => {
    const v = valueTree(pole(70), DEFAULT_SCENARIO);
    expect(v.poleLengthFt).toBe(70);
    expect(v.pricePerM3).toBe(500);
    expect(v.value).toBe(Math.round(v.volumeM3 * 500 * 100) / 100);
  });
});

describe('Stella-Jones red cedar card', () => {
  const cw = (circCm: number, ft: number, extra: Partial<TreeFields> = {}) =>
    ({ id: 'c', species: 'CW' as const, dbhCm: circCm / Math.PI, heightM: ft * 0.3048, straightness: 5 as const, twist: 5 as const, branchiness: 4 as const, ...extra });

  it('is the default card for cedar, rows as printed', () => {
    const card = DEFAULT_SCENARIO.poleSpec.cards![0];
    expect(card).toBe(STELLA_JONES_CEDAR_2026);
    expect(card.species).toEqual(['CW']);
    expect(card.rows.map((r) => r.minDiam6FtIn)).toEqual([13, 14, 16, 17, 19, 20, 22, 24, 25, 26, 27, 28]);
    expect(card.rows[5]).toEqual({ minDiam6FtIn: 20, lengthsFt: [73, 68, 63], minTopIn: 9 });
    expect(card.rows[9].lengthsFt).toEqual([108, 103, 98, 93, 88, 83, 78, 73]);
  });

  it('6 ft diameter comes from the taper: a little under DBH', () => {
    const r = longestPole(cw(200, 80), STELLA_JONES_CEDAR_2026)!;
    const dbhIn = 200 / Math.PI / 2.54;
    expect(r.diam6FtIn).toBeLessThan(dbhIn);
    expect(r.diam6FtIn).toBeGreaterThan(dbhIn * 0.8);
  });

  it('makes the longest length in its row whose top meets the minimum, sold as cut minus 3 ft', () => {
    const r = longestPole(cw(160, 80), STELLA_JONES_CEDAR_2026)!;
    // ~18.2" at 6 ft -> 17" row: 58 or 53 ft, 9" top.
    expect(r.cutLengthFt).toBe(58);
    expect(r.poleLengthFt).toBe(55);
    expect(r.topIn!).toBeGreaterThanOrEqual(9);
    const shorter = longestPole(cw(160, 70), STELLA_JONES_CEDAR_2026)!;
    expect(shorter.cutLengthFt).toBe(53);
  });

  it('valuation: card length picks the price band; pole piece at pole $, top at sawlog $', () => {
    const s: Scenario = { ...DEFAULT_SCENARIO, sawlogPricePerM3: { CW: 200 } };
    const v = valueTree(cw(160, 80), s);
    expect(v.product).toBe('pole');
    expect(v.poleLengthFt).toBe(55);
    expect(v.cutLengthFt).toBe(58);
    expect(v.pricePerM3).toBe(340);
    expect(v.topM3!).toBeGreaterThan(0);
    expect(v.value).toBeCloseTo(v.volumeM3 * 340 + v.topM3! * 200, 0);
    const big = valueTree(cw(200, 100), s);
    expect(big.poleLengthFt).toBeGreaterThanOrEqual(65);
    expect(big.pricePerM3).toBe(500);
  });

  it('under 13" at 6 ft, or too short for its row, is sawlog with the reason', () => {
    const small = valueTree(cw(100, 80), DEFAULT_SCENARIO);
    expect(small.product).toBe('sawlog');
    expect(small.notPoleReasons!.join()).toMatch(/under the card's 13" minimum/);
    const stubby = valueTree(cw(200, 50), DEFAULT_SCENARIO);
    expect(stubby.product).toBe('sawlog');
    expect(stubby.notPoleReasons!.join()).toMatch(/too short/);
  });

  it('any pole fault knocks it out of pole grade', () => {
    for (const f of ['damage', 'split', 'rot', 'barkSeam', 'knots', 'shake', 'sweep'] as const) {
      const v = valueTree(cw(160, 80, { poleFaults: [f] }), DEFAULT_SCENARIO);
      expect(v.product).toBe('sawlog');
      expect(v.notPoleReasons!.join()).toMatch(/pole fault/);
    }
    expect(evaluatePole(cw(160, 80, { poleFaults: ['shake'] }), DEFAULT_SCENARIO.poleSpec).reasons).toContain('pole fault: Shake');
  });

  it('summarize counts the pole top as sawlog volume', () => {
    const t = cw(160, 80);
    const v = valueTree(t, DEFAULT_SCENARIO);
    const s = summarize([t], DEFAULT_SCENARIO);
    expect(s.poleM3).toBeCloseTo(v.volumeM3, 3);
    expect(s.sawlogM3).toBeCloseTo(v.topM3!, 3);
    expect(s.totalVolumeM3).toBeCloseTo(v.volumeM3 + v.topM3!, 3);
  });

  it('old saved scenarios get the card', () => {
    const { cards: _c, ...oldSpec } = DEFAULT_SCENARIO.poleSpec;
    expect(normalizeScenario({ name: 'old', poleSpec: oldSpec }).poleSpec.cards).toEqual([STELLA_JONES_CEDAR_2026]);
  });
});

describe('pole faults by voice', () => {
  it.each([
    ['cedar circ 200 inches 70 feet spike knot at 30 feet', ['knots']],
    ['butt rot', ['rot']],
    ['no rot, frost crack', ['split']],
    ['no butt rot', []],
    ['shake in the butt and a bark seam', ['shake', 'barkSeam']],
    ['slight sweep', []],
    ['bad sweep', ['sweep']],
    ['damaged at the base', ['damage']],
    ['dead straight, no twist, clean', []],
  ])('"%s" -> %j', (text, faults) => {
    expect(parseUtterance(text).fields.poleFaults ?? []).toEqual(faults);
  });
  it('merges faults from several utterances', () => {
    const d = mergeDraft(mergeDraft({}, parseUtterance('spike knot').fields), parseUtterance('shake').fields);
    expect(d.poleFaults).toEqual(['knots', 'shake']);
  });
});

describe('pole faults survive the event log', () => {
  it('create and update carry poleFaults; [] clears via null', async () => {
    const { makeEvent, foldEvents } = await import('../src');
    const base = { treeId: 't', userId: 'u', deviceId: 'd' };
    const e1 = await makeEvent({ ...base, seq: 1, type: 'create', prevHash: '', createdAt: '2026-10-31T00:00:00.000Z',
      payload: { tag: 'J-0001', tagNumber: 1, prefix: 'J', position: { lat: 50, lon: -118, accuracyM: 3, fixCount: 3 }, fields: { species: 'CW', poleFaults: ['knots'] } } });
    expect(foldEvents([e1])!.poleFaults).toEqual(['knots']);
    const e2 = await makeEvent({ ...base, seq: 2, type: 'update', prevHash: e1.hash, createdAt: '2026-10-31T00:01:00.000Z', payload: { fields: { poleFaults: null } } });
    expect(foldEvents([e1, e2])!.poleFaults).toBeUndefined();
  });
});
