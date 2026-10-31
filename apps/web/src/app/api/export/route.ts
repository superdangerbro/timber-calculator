import { eq } from 'drizzle-orm';
import { DEFAULT_SCENARIO, toCsv, toGeoJson, toKml, treesInArea, type Scenario } from '@timber/core';
import { getDb } from '@/db';
import { blocks, scenarios } from '@/db/schema';
import { requireUser, route } from '@/lib/server/http';
import { rowToBlock, rowToScenario } from '@/lib/server/rows';
import { HttpError, listTrees } from '@/lib/server/sync';

export const dynamic = 'force-dynamic';

/** GET /api/export?format=csv|geojson|kml&blockId=&scenarioId=&ids=a,b&includeVoided=1 */
export const GET = route(async (req) => {
  await requireUser(req);
  const q = new URL(req.url).searchParams;
  const format = q.get('format') ?? 'csv';
  const db = getDb();
  let list = await listTrees(db);
  if (q.get('includeVoided') !== '1') list = list.filter((t) => !t.voided);
  const ids = q.get('ids');
  if (ids) { const set = new Set(ids.split(',')); list = list.filter((t) => set.has(t.id)); }
  let boundary: GeoJSON.Polygon | undefined;
  let name = 'Timber export';
  const blockId = q.get('blockId');
  if (blockId) {
    const [row] = await db.select().from(blocks).where(eq(blocks.id, blockId));
    if (!row) throw new HttpError(404, 'Block not found');
    const b = rowToBlock(row);
    list = treesInArea(list, b.boundary);
    name = b.name;
    if (b.boundary.type === 'Polygon') boundary = b.boundary;
  }
  let scenario: Scenario = DEFAULT_SCENARIO;
  const sid = q.get('scenarioId');
  if (sid) {
    const [row] = await db.select().from(scenarios).where(eq(scenarios.id, sid));
    if (row) scenario = rowToScenario(row);
  }
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `${name.replace(/[^A-Za-z0-9_-]+/g, '_')}_${stamp}`;
  if (format === 'csv') return file(toCsv(list, scenario), 'text/csv', `${base}.csv`);
  if (format === 'geojson') return file(JSON.stringify(toGeoJson(list, scenario), null, 1), 'application/geo+json', `${base}.geojson`);
  if (format === 'kml') return file(toKml(list, { name, boundary }), 'application/vnd.google-earth.kml+xml', `${base}.kml`);
  throw new HttpError(400, 'format must be csv, geojson or kml');
});

function file(body: string, type: string, filename: string) {
  return new Response(body, { headers: { 'Content-Type': `${type}; charset=utf-8`, 'Content-Disposition': `attachment; filename="${filename}"` } });
}
