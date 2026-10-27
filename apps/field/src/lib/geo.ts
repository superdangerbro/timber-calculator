const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;

export function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Initial bearing from a to b, degrees clockwise from north. */
export function bearingDeg(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function compassPoint(deg: number) {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
}

export function circlePolygon(lat: number, lon: number, radiusM: number, steps = 48): GeoJSON.Polygon {
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    ring.push([
      lon + (radiusM * Math.sin(a)) / (111320 * Math.cos(rad(lat))),
      lat + (radiusM * Math.cos(a)) / 111320,
    ]);
  }
  return { type: 'Polygon', coordinates: [ring] };
}

export function geometryBbox(g: GeoJSON.Polygon | GeoJSON.MultiPolygon): [number, number, number, number] {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  for (const p of polys)
    for (const ring of p)
      for (const [x, y] of ring) {
        w = Math.min(w, x);
        e = Math.max(e, x);
        s = Math.min(s, y);
        n = Math.max(n, y);
      }
  return [w, s, e, n];
}

/** Pull the first Polygon/MultiPolygon out of a GeoJSON or KML document. */
export function parseBoundary(text: string): { name?: string; geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon } {
  const t = text.trim();
  if (t.startsWith('{')) {
    const j = JSON.parse(t);
    const feats: any[] =
      j.type === 'FeatureCollection' ? j.features : j.type === 'Feature' ? [j] : [{ type: 'Feature', geometry: j }];
    for (const f of feats) {
      const g = f?.geometry;
      if (g && (g.type === 'Polygon' || g.type === 'MultiPolygon')) {
        return { name: f.properties?.name ?? f.properties?.code, geometry: g };
      }
    }
    throw new Error('No polygon found in GeoJSON');
  }
  const doc = new DOMParser().parseFromString(t, 'application/xml');
  const polys = [...doc.getElementsByTagName('Polygon')];
  if (!polys.length) throw new Error('No polygon found in KML');
  const toRing = (el: Element | undefined) =>
    (el?.getElementsByTagName('coordinates')[0]?.textContent ?? '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((c) => {
        const [x, y] = c.split(',').map(Number);
        return [x, y] as [number, number];
      });
  const coords = polys.map((p) => {
    const outer = toRing(p.getElementsByTagName('outerBoundaryIs')[0]);
    const inner = [...p.getElementsByTagName('innerBoundaryIs')].map((el) => toRing(el));
    return [outer, ...inner];
  });
  const name = doc.getElementsByTagName('Placemark')[0]?.getElementsByTagName('name')[0]?.textContent ?? undefined;
  return {
    name: name || undefined,
    geometry: coords.length === 1 ? { type: 'Polygon', coordinates: coords[0] } : { type: 'MultiPolygon', coordinates: coords },
  };
}
