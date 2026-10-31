// Per-viewer UI conveniences in localStorage (never source of truth).
import type { Scenario } from '@timber/core';
import type { Filters } from './filters';

export const REPORT_KEY = 'report';
export interface ReportState {
  filters: Filters;
  area: { kind: string; name: string; geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon; blockId?: string } | null;
  scenario: Scenario; scenarioName: string; dirty: boolean; createdAt: string; by: string;
}

export function loadPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem('timber.' + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch { return fallback; }
}
export function savePref(key: string, value: unknown) {
  try { localStorage.setItem('timber.' + key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}
