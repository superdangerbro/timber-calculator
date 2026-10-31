import { describe, expect, it } from 'vitest';
import fixtures from './fixtures/kozak-dib.json';
import { dibCm, kozakCoefficients, kozakTreeVolume, stemVolumeM3, totalHeightFromMerch } from '../src';

describe('Kozak 2002 BEC taper', () => {
  // Expected diameters are the Ministry's own test values, taken from the provincial SAS compiler.
  it.each(fixtures.cases.map((c) => [c.species, c.bec, c.dbhCm, c.totalHeightM, c.dibCm] as const))(
    '%s in %s, DBH %s cm, H %s m -> DIB at 1.4 m = %s cm',
    (species, bec, dbh, H, expected) => {
      const c = kozakCoefficients(species, bec)!;
      expect(c).not.toBeNull();
      expect(dibCm(c, dbh, H, 1.4)).toBeCloseTo(expected, 3);
    },
  );

  it('maps our species codes to Ministry groups', () => {
    expect(kozakCoefficients('FD', 'IDF')).toBe(kozakCoefficients('F', 'IDF'));
    expect(kozakCoefficients('SX', 'ESSF')).toBe(kozakCoefficients('S', 'ESSF'));
    expect(kozakCoefficients('FD', 'NOPE')).toBeNull();
    expect(kozakCoefficients('ZZ', 'ICH')).toBeNull();
  });

  it('40 cm, 30 m Douglas-fir whole stem is about 1.33 m³', () => {
    const c = kozakCoefficients('FD', 'IDF')!;
    const v = stemVolumeM3(c, 40, 30, 30, 0);
    expect(v).toBeGreaterThan(1.3);
    expect(v).toBeLessThan(1.36);
  });
});

describe('total height from marketable height', () => {
  it('round-trips: the stem is exactly the top diameter at the marketable height', () => {
    for (const [sp, bec, dbh, mh] of [
      ['FD', 'IDF', 40, 22],
      ['PL', 'SBS', 25, 15],
      ['CW', 'ICH', 60, 25],
      ['LW', 'ICH', 35, 20],
    ] as const) {
      const c = kozakCoefficients(sp, bec)!;
      const H = totalHeightFromMerch(c, dbh, mh, 15);
      expect(H).toBeGreaterThan(mh);
      expect(dibCm(c, dbh, H, mh)).toBeCloseTo(15, 3);
    }
  });

  it('a tree too small for the top at that height falls back to a top of half the DBH', () => {
    const c = kozakCoefficients('PL', 'SBS')!;
    expect(dibCm(c, 16, 200, 12)).toBeLessThan(15); // 15 cm is unreachable at 12 m
    const H = totalHeightFromMerch(c, 16, 12, 15);
    expect(dibCm(c, 16, H, 12)).toBeCloseTo(8, 3);
  });
});

describe('kozakTreeVolume', () => {
  it('40 cm Douglas-fir with 22 m marketable height to a 15 cm top', () => {
    const v = kozakTreeVolume('FD', 40, 22, { becZone: 'IDF', topDibCm: 15 })!;
    expect(v.totalHeightM).toBeGreaterThan(26);
    expect(v.totalHeightM).toBeLessThan(34);
    expect(v.merchVolumeM3).toBeGreaterThan(1.0);
    expect(v.merchVolumeM3).toBeLessThan(v.wholeStemVolumeM3);
  });

  it('grows with DBH and height, and with a smaller top', () => {
    const base = kozakTreeVolume('SX', 35, 20)!.merchVolumeM3;
    expect(kozakTreeVolume('SX', 45, 20)!.merchVolumeM3).toBeGreaterThan(base);
    expect(kozakTreeVolume('SX', 35, 24)!.merchVolumeM3).toBeGreaterThan(base);
    // Same marketable height to a smaller top means a shorter tree, so a little less volume below that height.
    expect(kozakTreeVolume('SX', 35, 20, { topDibCm: 10 })!.merchVolumeM3).toBeLessThan(base);
  });

  it('bad input', () => {
    expect(kozakTreeVolume('FD', 0, 20)).toBeNull();
    expect(kozakTreeVolume('FD', 30, 0)).toBeNull();
    expect(kozakTreeVolume('FD', 30, 20, { becZone: 'XX' })).toBeNull();
  });
});
