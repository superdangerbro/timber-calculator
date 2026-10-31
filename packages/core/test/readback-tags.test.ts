import { describe, expect, it } from 'vitest';
import { formatTag, nextTagNumber, readbackText, tagSpeech } from '../src';

describe('tags', () => {
  it('formats with 4-digit minimum', () => {
    expect(formatTag('J', 147)).toBe('J-0147');
    expect(formatTag('J', 12345)).toBe('J-12345');
    expect(formatTag('j', 1)).toBe('J-0001');
  });
  it('block code and leave series', () => {
    expect(formatTag('J', 147, { blockCode: 'CB12' })).toBe('CB12-J-0147');
    expect(formatTag('J', 3, { leave: true })).toBe('J-L0003');
    expect(formatTag('J', 3, { leave: true, blockCode: 'CB12' })).toBe('CB12-J-L0003');
  });
  it('nextTagNumber = max + 1, never reuses', () => {
    expect(nextTagNumber([])).toBe(1);
    expect(nextTagNumber([1, 2, 7, 3])).toBe(8);
  });
});

describe('readback', () => {
  it('reads back present fields and missing ones', () => {
    expect(readbackText({ species: 'FD', dbhCm: 42, heightM: 30, straightness: 4, branchiness: 3 })).toBe(
      'Douglas-fir, 42 centimetres, 30 metres, straightness 4, branchiness 3. Missing: twist.',
    );
  });
  it('complete draft has no Missing part', () => {
    const t = readbackText({ species: 'CW', dbhCm: 61, heightM: 24, straightness: 3, twist: 5, branchiness: 4, defects: 'catface' });
    expect(t).toBe('Western redcedar, 61 centimetres, 24 metres, straightness 3, twist 5, branchiness 4, defects: catface.');
  });
  it('leave tree', () => {
    expect(readbackText({ leaveTree: true, species: 'PY', dbhCm: 70 })).toBe('Leave tree, Ponderosa pine, 70 centimetres.');
  });
  it('empty draft', () => {
    expect(readbackText({})).toBe('Nothing recorded. Missing: species, DBH, height, straightness, twist, branchiness.');
  });
  it('tagSpeech spells digits', () => {
    expect(tagSpeech('J-0147')).toBe('Tag J, zero one four seven.');
    expect(tagSpeech('J-L0003')).toBe('Tag J, L, zero zero zero three.');
    expect(tagSpeech('CB12-J-0147')).toBe('Tag C B, one two, J, zero one four seven.');
  });
});
