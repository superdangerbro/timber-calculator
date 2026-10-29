import { describe, expect, it } from 'vitest';
import { foldEvents, makeEvent, mergeDraft, parseUtterance, readbackText, toCsv, toGeoJson } from '../src';
import type { ParseOptions, TreeFields } from '../src';

const JOE: ParseOptions = { units: 'imperial', measure: 'circumference' };
const dbhOf = (c: number) => Math.round((c / Math.PI) * 10) / 10;

// [utterance, options, expected subset]
const cases: [string, ParseOptions, TreeFields][] = [
  ['circumference 75 inches', {}, { circumferenceCm: 190.5, dbhCm: dbhOf(190.5) }],
  ['circumference seventy five inches', {}, { circumferenceCm: 190.5 }],
  ['circ 75', JOE, { circumferenceCm: 190.5 }],
  ['circ 75 inches', {}, { circumferenceCm: 190.5 }],
  ['girth 80 inches', {}, { circumferenceCm: 203.2 }],
  ['around 75 inches', {}, { circumferenceCm: 190.5 }],
  ['seventy five inch circumference', {}, { circumferenceCm: 190.5 }],
  ['75 inches around', {}, { circumferenceCm: 190.5 }],
  ['75 circumference', JOE, { circumferenceCm: 190.5 }],
  ['circumference 190 cm', {}, { circumferenceCm: 190, dbhCm: dbhOf(190) }],
  ['circumference is one hundred ninety centimetres', {}, { circumferenceCm: 190 }],
  ['circumference 190', {}, { circumferenceCm: 190 }],
  ['dbh 24', JOE, { dbhCm: 61 }],
  ['dbh 24 inches', {}, { dbhCm: 61 }],
  ['24 inch diameter', JOE, { dbhCm: 61 }],
  ['fir 75 inches 98 feet', JOE, { species: 'FD', circumferenceCm: 190.5, heightM: 29.9 }],
  ['fir seventy five ninety eight', JOE, { species: 'FD', circumferenceCm: 190.5, heightM: 29.9 }],
  ['ninety feet', JOE, { heightM: 27.4 }],
  ['90 ft', {}, { heightM: 27.4 }],
  ['one foot', {}, { heightM: 0.3 }],
  ['height 98', JOE, { heightM: 29.9 }],
  ['height 30', {}, { heightM: 30 }],
  ['98 tall', JOE, { heightM: 29.9 }],
  ['fir circumference seventy five inches ninety eight feet straight four no twist clean', {}, {
    species: 'FD', circumferenceCm: 190.5, dbhCm: 60.6, heightM: 29.9, straightness: 4, twist: 5, branchiness: 5,
  }],
  ['circ 75 then dbh 25 inches', {}, { dbhCm: 63.5 }],
  ['dbh 25 inches circ 75', JOE, { circumferenceCm: 190.5, dbhCm: 60.6 }],
  ['no, seventy eight inches', JOE, { circumferenceCm: 198.1 }],
  ['circumference 75, no, 78', JOE, { circumferenceCm: 198.1 }],
  ['circumference 75 inches, no, seventy eight inches', {}, { circumferenceCm: 198.1 }],
  ['height 90 feet, no, ninety eight feet', {}, { heightM: 29.9 }],
  ['fir 42', {}, { species: 'FD', dbhCm: 42 }],
];

describe('circumference and imperial parsing', () => {
  for (const [u, o, want] of cases) {
    it(`${JSON.stringify(u)} ${JSON.stringify(o)}`, () => {
      expect(parseUtterance(u, o).fields).toMatchObject(want);
    });
  }
  it('a DBH after a circumference wins and clears the circumference', () => {
    const r = parseUtterance('circ 75 then dbh 25 inches');
    expect(r.fields.circumferenceCm).toBeUndefined();
  });
  it('around a small number is still approximate DBH in dbh mode', () => {
    expect(parseUtterance('around 16 inches').fields).toMatchObject({ dbhCm: 40.6 });
    expect(parseUtterance('around 16 inches').fields.circumferenceCm).toBeUndefined();
  });
  it('photo command', () => {
    expect(parseUtterance('take a photo').command).toBe('photo');
    expect(parseUtterance('photo').command).toBe('photo');
  });
});

describe('mergeDraft with circumference', () => {
  it('later DBH clears an earlier circumference; later circumference replaces DBH', () => {
    const a = mergeDraft({}, parseUtterance('circ 75', JOE).fields);
    expect(a.circumferenceCm).toBe(190.5);
    const b = mergeDraft(a, parseUtterance('dbh 25', JOE).fields);
    expect(b.dbhCm).toBe(63.5);
    expect(b.circumferenceCm).toBeUndefined();
    const c = mergeDraft(b, parseUtterance('circ 78', JOE).fields);
    expect(c.circumferenceCm).toBe(198.1);
    expect(c.dbhCm).toBe(dbhOf(198.1));
  });
});

describe('readback units', () => {
  const draft: TreeFields = { species: 'FD', circumferenceCm: 190.5, dbhCm: 60.6, heightM: 29.9, straightness: 4, twist: 5, branchiness: 5 };
  it('imperial', () => {
    expect(readbackText(draft, { units: 'imperial' })).toBe(
      'Douglas-fir, circumference 75 inches, DBH 23.9 inches, 98 feet, straightness 4, twist 5, branchiness 5.',
    );
  });
  it('metric', () => {
    expect(readbackText(draft)).toBe(
      'Douglas-fir, circumference 190.5 centimetres, DBH 60.6 centimetres, 29.9 metres, straightness 4, twist 5, branchiness 5.',
    );
  });
  it('no circumference reads DBH plainly', () => {
    expect(readbackText({ species: 'FD', dbhCm: 61 }, { units: 'imperial' })).toMatch(/^Douglas-fir, 24 inches\./);
  });
  it('a missing girth is "circumference" when that is how it is taped', () => {
    expect(readbackText({ species: 'FD' }, { units: 'imperial', measure: 'circumference' })).toMatch(/Missing: circumference, height/);
    expect(readbackText({ species: 'FD' }, { units: 'imperial' })).toMatch(/Missing: DBH, height/);
  });
});

describe('circumference and photos in events and exports', () => {
  it('folds circumference and appends photos', async () => {
    const base = { userId: 'u', deviceId: 'd' };
    const c = await makeEvent({ ...base, treeId: 't', seq: 1, type: 'create', prevHash: '', payload: {
      tag: 'J-0001', tagNumber: 1, prefix: 'J', position: { lat: 50.7, lon: -120.35, accuracyM: 4, fixCount: 9 },
      fields: { species: 'FD', circumferenceCm: 190.5, dbhCm: 60.6, heightM: 29.9 } } });
    const photo = { id: 'p1', takenAt: c.createdAt, width: 1280, height: 960, bytes: 200000, sha256: 'ab'.repeat(32) };
    const u1 = await makeEvent({ ...base, treeId: 't', seq: 2, type: 'update', prevHash: c.hash, payload: { photos: [photo] } });
    const u2 = await makeEvent({ ...base, treeId: 't', seq: 3, type: 'update', prevHash: u1.hash, payload: { photos: [photo, { ...photo, id: 'p2' }] } });
    const t = foldEvents([c, u1, u2])!;
    expect(t.circumferenceCm).toBe(190.5);
    expect(t.photos?.map((p) => p.id)).toEqual(['p1', 'p2']);
    const csv = toCsv([t]);
    expect(csv.split('\r\n')[0]).toContain('circumference_cm');
    expect(csv.split('\r\n')[1]).toContain('190.5');
    expect(toGeoJson([t]).features[0].properties?.circumference_cm).toBe(190.5);
  });
});
