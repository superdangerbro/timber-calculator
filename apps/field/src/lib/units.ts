import type { UnitSystem } from '@timber/core';

// Display conversions. Everything is stored metric (cm, m); these only change
// what the screen shows and what the editor accepts.

const r1 = (n: number) => Math.round(n * 10) / 10;

export const girthUnit = (u: UnitSystem) => (u === 'imperial' ? 'in' : 'cm');
export const heightUnit = (u: UnitSystem) => (u === 'imperial' ? 'ft' : 'm');

/** cm -> shown number (inches or cm, 0.1). */
export function showGirth(cm: number, u: UnitSystem): number {
  return u === 'imperial' ? r1(cm / 2.54) : r1(cm);
}
/** m -> shown number (whole feet or 0.1 m). */
export function showHeight(m: number, u: UnitSystem): number {
  return u === 'imperial' ? Math.round(m / 0.3048) : r1(m);
}
/** Typed number in display units -> cm. */
export function girthToCm(v: number, u: UnitSystem): number {
  return u === 'imperial' ? r1(v * 2.54) : v;
}
/** Typed number in display units -> m. */
export function heightToM(v: number, u: UnitSystem): number {
  return u === 'imperial' ? r1(v * 0.3048) : v;
}
/** DBH from a circumference, both cm. */
export const dbhFromCirc = (cm: number) => r1(cm / Math.PI);

export function girthText(cm: number | null | undefined, u: UnitSystem): string {
  return cm === undefined || cm === null ? '—' : `${showGirth(cm, u)} ${girthUnit(u)}`;
}
export function heightText(m: number | null | undefined, u: UnitSystem): string {
  return m === undefined || m === null ? '—' : `${showHeight(m, u)} ${heightUnit(u)}`;
}
