import { describe, expect, it } from 'vitest';
import { formatField, fieldUnit } from '../src/components/fields';
import { dbhFromCirc, girthText, girthToCm, heightText, heightToM, showGirth, showHeight } from '../src/lib/units';
import { defaultSettings } from '../src/state/settings';
import { makeRig } from './helpers';

describe('display units', () => {
  it('Joe defaults: imperial, circumference', () => {
    const s = defaultSettings('d');
    expect(s.units).toBe('imperial');
    expect(s.measure).toBe('circumference');
  });
  it('converts for display and back (storage stays metric)', () => {
    expect(showGirth(190.5, 'imperial')).toBe(75);
    expect(showGirth(190.5, 'metric')).toBe(190.5);
    expect(showHeight(29.9, 'imperial')).toBe(98);
    expect(showHeight(29.9, 'metric')).toBe(29.9);
    expect(girthToCm(75, 'imperial')).toBe(190.5);
    expect(heightToM(98, 'imperial')).toBe(29.9);
    expect(dbhFromCirc(190.5)).toBe(60.6);
    expect(girthText(60.6, 'imperial')).toBe('23.9 in');
    expect(heightText(29.9, 'imperial')).toBe('98 ft');
    expect(girthText(undefined, 'metric')).toBe('—');
  });
  it('form fields format in the chosen units', () => {
    const f = { circumferenceCm: 190.5, dbhCm: 60.6, heightM: 29.9 };
    expect(formatField('circumferenceCm', f, 'imperial')).toBe('75');
    expect(formatField('dbhCm', f, 'imperial')).toBe('23.9');
    expect(formatField('heightM', f, 'imperial')).toBe('98');
    expect(fieldUnit('heightM', 'imperial')).toBe('ft');
    expect(fieldUnit('dbhCm', 'metric')).toBe('cm');
  });
});

describe('tally with circumference in imperial', () => {
  it('stores metric, reads back in inches and feet', async () => {
    const { tally, tts, repo } = await makeRig({ imperial: true });
    tally.newTree();
    await tally.toggleVoice();
    await tally.hear('fir circumference seventy five inches ninety eight feet straight four no twist clean');
    const d = tally.getState().draft;
    expect(d).toMatchObject({ species: 'FD', circumferenceCm: 190.5, dbhCm: 60.6, heightM: 29.9 });
    expect(tts.spoken.at(-1)).toBe('Douglas-fir, circumference 75 inches, DBH 23.9 inches, 98 feet, straightness 4, twist 5, branchiness 5.');
    await tally.hear('save');
    const t = repo.getState().trees[0];
    expect(t.circumferenceCm).toBe(190.5);
    expect(t.dbhCm).toBe(60.6);
  });
  it('bare numbers are circumference inches then feet', async () => {
    const { tally } = await makeRig({ imperial: true });
    tally.newTree();
    await tally.hear('fir seventy five ninety eight');
    expect(tally.getState().draft).toMatchObject({ circumferenceCm: 190.5, heightM: 29.9 });
    await tally.hear('no, seventy eight inches');
    expect(tally.getState().draft.circumferenceCm).toBe(198.1);
  });
  it('"photo" asks for a photo of the last saved tree', async () => {
    const { tally } = await makeRig({ imperial: true });
    tally.newTree();
    await tally.hear('fir circ 75 98 feet straight 4 twist 4 clean');
    await tally.hear('save');
    expect(tally.getState().step).toBe('saved');
    await tally.hear('take a photo');
    expect(tally.getState().photoRequest?.tag).toBe('J-0001');
    await tally.photoDone(false);
    expect(tally.getState().photoRequest).toBeNull();
  });
});
