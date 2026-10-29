// Parse boundary files (GeoJSON / KML) into a Polygon or MultiPolygon. Browser only (DOMParser).
type Geom = GeoJSON.Polygon | GeoJSON.MultiPolygon;

export async function parseBoundaryFile(file: File): Promise<{ geometry: Geom; name: string }> {
  const text = await file.text();
  const lower = file.name.toLowerCase();
  const base = file.name.replace(/\.[^.]+$/, '');
  if (lower.endsWith('.shp') || lower.endsWith('.zip')) throw new Error('Shapefile import is coming soon. Export the boundary as KML or GeoJSON for now.');
  if (lower.endsWith('.kml') || text.trimStart().startsWith('<')) return { geometry: parseKml(text), name: kmlName(text) ?? base };
  return { geometry: parseGeoJson(JSON.parse(text)), name: base };
}

export function parseGeoJson(obj: unknown): Geom {
  const polys: GeoJSON.Position[][][] = [];
  const visit = (g: unknown) => {
    const o = g as { type?: string; coordinates?: unknown; geometry?: unknown; features?: unknown[]; geometries?: unknown[] };
    if (!o || typeof o !== 'object') return;
    if (o.type === 'FeatureCollection') o.features?.forEach(visit);
    else if (o.type === 'Feature') visit(o.geometry);
    else if (o.type === 'GeometryCollection') o.geometries?.forEach(visit);
    else if (o.type === 'Polygon') polys.push(o.coordinates as GeoJSON.Position[][]);
    else if (o.type === 'MultiPolygon') polys.push(...(o.coordinates as GeoJSON.Position[][][]));
  };
  visit(obj);
  return toGeom(polys);
}

function toGeom(polys: GeoJSON.Position[][][]): Geom {
  if (!polys.length) throw new Error('No polygon found in the file');
  const clean = polys.map((p) => p.map((r) => r.map((c) => [Number(c[0]), Number(c[1])])));
  return clean.length === 1 ? { type: 'Polygon', coordinates: clean[0] } : { type: 'MultiPolygon', coordinates: clean };
}

function kmlName(text: string): string | null {
  const m = text.match(/<name>\s*(?:<!\[CDATA\[)?([^<\]]+)/i);
  return m ? m[1].trim() : null;
}

export function parseKml(text: string): Geom {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Could not read the KML file');
  const ring = (el: Element | null | undefined) => {
    const coords = el?.getElementsByTagName('coordinates')[0]?.textContent ?? '';
    return coords.trim().split(/\s+/).filter(Boolean).map((t) => t.split(',').slice(0, 2).map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite));
  };
  const polys: GeoJSON.Position[][][] = [];
  for (const p of Array.from(doc.getElementsByTagName('Polygon'))) {
    const outer = ring(p.getElementsByTagName('outerBoundaryIs')[0]);
    if (outer.length < 3) continue;
    const holes = Array.from(p.getElementsByTagName('innerBoundaryIs')).map((h) => ring(h)).filter((r) => r.length >= 3);
    polys.push([close(outer), ...holes.map(close)]);
  }
  return toGeom(polys);
}

function close(r: GeoJSON.Position[]) {
  const [a, b] = [r[0], r[r.length - 1]];
  return a[0] === b[0] && a[1] === b[1] ? r : [...r, a];
}

export function bboxOf(g: Geom): [number, number, number, number] {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  const rings = g.type === 'Polygon' ? g.coordinates : g.coordinates.flat();
  for (const r of rings) for (const [x, y] of r) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  return [w, s, e, n];
}

export function centroidOf(g: Geom): [number, number] {
  const ring = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0];
  let x = 0, y = 0; const n = ring.length - 1 || 1;
  for (let i = 0; i < n; i++) { x += ring[i][0]; y += ring[i][1]; }
  return [x / n, y / n];
}
