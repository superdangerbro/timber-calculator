import { describe, expect, it } from 'vitest';
import { SPECIES, SPECIES_COLORS, speciesByCode, speciesName } from '../src';

describe('species', () => {
  it('has the 11 Interior BC species with colours', () => {
    expect(SPECIES.map((s) => s.code).sort()).toEqual(['AC', 'AT', 'BL', 'CW', 'EP', 'FD', 'HW', 'LW', 'PL', 'PY', 'SX']);
    for (const s of SPECIES) expect(SPECIES_COLORS[s.code]).toMatch(/^#[0-9a-f]{6}$/);
    expect(new Set(Object.values(SPECIES_COLORS)).size).toBe(SPECIES.length);
  });
  it('lookups', () => {
    expect(speciesByCode('FD')?.name).toBe('Douglas-fir');
    expect(speciesByCode('fd')?.code).toBe('FD');
    expect(speciesByCode('XX')).toBeUndefined();
    expect(speciesName('CW')).toBe('Western redcedar');
    expect(speciesName('ZZ')).toBe('ZZ');
  });
  it('"fir" alone is FD', () => {
    expect(speciesByCode('FD')!.aliases).toContain('fir');
    expect(SPECIES.filter((s) => s.aliases.includes('fir')).map((s) => s.code)).toEqual(['FD']);
  });
});
