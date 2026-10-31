import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import { area as turfArea } from '@turf/area';

/** Trees whose lat/lon fall inside the polygon (boundary counts as inside). */
export function treesInArea<T extends { lat: number; lon: number }>(
  trees: T[],
  polygon: GeoJSON.Polygon | GeoJSON.MultiPolygon,
): T[] {
  return trees.filter(
    (t) =>
      Number.isFinite(t.lat) &&
      Number.isFinite(t.lon) &&
      booleanPointInPolygon([t.lon, t.lat], polygon, { ignoreBoundary: false }),
  );
}

/** Geodesic area of a polygon in hectares. */
export function polygonAreaHa(polygon: GeoJSON.Polygon | GeoJSON.MultiPolygon): number {
  return turfArea(polygon) / 10000;
}
