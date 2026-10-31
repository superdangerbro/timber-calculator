import { describe, expect, it } from 'vitest';
import { averageFixes, heightFromAngles } from '../src';
import type { GpsFix } from '../src';

const fix = (lat: number, lon: number, accuracyM: number): GpsFix => ({ lat, lon, accuracyM, timestamp: 0 });

describe('averageFixes', () => {
  it('weights by inverse variance', () => {
    // weights: 1/1 and 1/4 -> mean = (0*1 + 1*0.25)/1.25 = 0.2
    const r = averageFixes([fix(50, -120, 1), fix(51, -121, 2)]);
    expect(r.lat).toBeCloseTo(50.2, 9);
    expect(r.lon).toBeCloseTo(-120.2, 9);
    expect(r.fixCount).toBe(2);
    expect(r.accuracyM).toBe(1); // 1/sqrt(1.25) = 0.89 -> floor 1
  });
  it('drops fixes worse than 3x the best', () => {
    const r = averageFixes([fix(50, -120, 4), fix(50.0001, -120, 4), fix(60, -130, 13)]);
    expect(r.fixCount).toBe(2);
    expect(r.lat).toBeCloseTo(50.00005, 9);
    expect(r.accuracyM).toBeCloseTo(4 / Math.sqrt(2), 1);
  });
  it('equal weights = plain mean', () => {
    const r = averageFixes([fix(1, 1, 5), fix(3, 3, 5)]);
    expect(r.lat).toBeCloseTo(2);
    expect(r.lon).toBeCloseTo(2);
  });
  it('no fixes', () => {
    expect(averageFixes([]).fixCount).toBe(0);
  });
});

describe('heightFromAngles', () => {
  it('20 m, top 50°, base -5° -> 25.6', () => {
    expect(heightFromAngles({ distanceM: 20, topDeg: 50, baseDeg: -5 })).toBe(25.6);
  });
  it('45° at 30 m, base level -> 30', () => {
    expect(heightFromAngles({ distanceM: 30, topDeg: 45, baseDeg: 0 })).toBe(30);
  });
  it('uphill base (positive base angle)', () => {
    expect(heightFromAngles({ distanceM: 20, topDeg: 60, baseDeg: 10 })).toBeCloseTo(20 * (Math.tan(Math.PI / 3) - Math.tan(Math.PI / 18)), 1);
  });
  it('invalid -> NaN', () => {
    expect(heightFromAngles({ distanceM: 0, topDeg: 50, baseDeg: -5 })).toBeNaN();
    expect(heightFromAngles({ distanceM: 20, topDeg: -10, baseDeg: 5 })).toBeNaN();
    expect(heightFromAngles({ distanceM: 20, topDeg: 90, baseDeg: 0 })).toBeNaN();
  });
});
