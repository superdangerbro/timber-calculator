// Seeds a demo crew, block CB12 near Kamloops and ~120 trees, all through real
// hash-chained events (makeEvent) pushed via the same code path as the sync API.
// WARNING: wipes existing data in DATABASE_URL.
import './env';
import { sql as dsql } from 'drizzle-orm';
import { DEFAULT_SCENARIO, formatTag, makeEvent, polygonAreaHa, uuid, type Scenario, type SpeciesCode, type TreeEvent, type TreeFields } from '@timber/core';
import { createDb, type DB } from '../src/db';
import { scenarios } from '../src/db/schema';
import { appendWebEvent, pushEvents } from '../src/lib/server/sync';
import { createUser } from '../src/lib/server/users';

// Deterministic PRNG so the demo looks the same every time.
let s = 0x2f6b1a;
const rand = () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const between = (a: number, b: number) => a + rand() * (b - a);
const pick = <T>(xs: [T, number][]): T => { const tot = xs.reduce((a, x) => a + x[1], 0); let r = rand() * tot; for (const [v, w] of xs) { if ((r -= w) <= 0) return v; } return xs[xs.length - 1][0]; };
const gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += rand(); return u / 6; }; // 0..1, bell-ish
const round1 = (n: number) => Math.round(n * 10) / 10;

export const CB12_CENTER = { lat: 50.7008, lon: -120.3502 };
const M_PER_DEG_LAT = 111_200;
const M_PER_DEG_LON = 111_320 * Math.cos((CB12_CENTER.lat * Math.PI) / 180);
const offsetsM: [number, number][] = [
  [-300, -190], [-150, -255], [70, -245], [250, -180], [315, -40], [280, 120], [160, 235], [-30, 255], [-200, 200], [-300, 80], [-330, -60],
];
const ring = offsetsM.map(([x, y]) => [round6(CB12_CENTER.lon + x / M_PER_DEG_LON), round6(CB12_CENTER.lat + y / M_PER_DEG_LAT)]);
ring.push(ring[0]);
function round6(n: number) { return Math.round(n * 1e6) / 1e6; }
export const CB12_BOUNDARY: GeoJSON.Polygon = { type: 'Polygon', coordinates: [ring] };

function inRing(lon: number, lat: number, r: number[][]) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i]; const [xj, yj] = r[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function randomPointInBlock() {
  const xs = ring.map((p) => p[0]); const ys = ring.map((p) => p[1]);
  for (;;) {
    const lon = between(Math.min(...xs), Math.max(...xs));
    const lat = between(Math.min(...ys), Math.max(...ys));
    if (inRing(lon, lat, ring)) return { lat: Math.round(lat * 1e7) / 1e7, lon: Math.round(lon * 1e7) / 1e7 };
  }
}

const SPECIES_MIX: [SpeciesCode, number][] = [['FD', 40], ['PL', 20], ['LW', 14], ['SX', 12], ['CW', 8], ['PY', 4], ['BL', 2]];
const DEFECTS = ['sweep', 'conk', 'frost crack', 'dead top', 'fork at 18 m', 'catface', 'butt rot', 'crook'];
const NOTES = ['near skid trail', 'flagged boundary side', 'wildlife tree nearby', 'on slope break', 'check with buyer', ''];

function makeFields(leave: boolean): TreeFields {
  const species = leave ? pick<SpeciesCode>([['FD', 3], ['PY', 2], ['LW', 1]]) : pick(SPECIES_MIX);
  const big = species === 'CW' || species === 'FD' || species === 'PY' ? 1.15 : species === 'PL' ? 0.8 : 1;
  let dbh = Math.round(Math.min(70, Math.max(18, (18 + gauss() * 52) * big + (leave ? 15 : 0))));
  if (dbh > 70) dbh = 70;
  const height = round1(Math.min(38, Math.max(12, 6 + dbh * 0.48 + between(-4, 4) + (species === 'PL' ? 3 : 0))));
  const good = species === 'PL' || species === 'LW' || species === 'FD' ? 0.7 : 0.4;
  const score = (q: number) => (rand() < q ? pick<1 | 2 | 3 | 4 | 5>([[4, 5], [5, 4], [3, 1]]) : pick<1 | 2 | 3 | 4 | 5>([[1, 1], [2, 3], [3, 4], [4, 2]]));
  const f: TreeFields = {
    species, dbhCm: dbh, heightM: height,
    heightSource: rand() < 0.3 ? 'clinometer' : 'spoken',
    straightness: score(good), twist: score(good + 0.1), branchiness: score(good - 0.05),
  };
  if (rand() < 0.14) f.defects = DEFECTS[Math.floor(rand() * DEFECTS.length)];
  if (leave) { f.leaveTree = true; f.notes = pick([['wildlife tree', 2], ['seed tree', 3], ['riparian reserve', 1]]); }
  else if (rand() < 0.1) { const n = NOTES[Math.floor(rand() * NOTES.length)]; if (n) f.notes = n; }
  return f;
}

interface Crew { userId: string; prefix: string; devices: { id: string; name: string }[]; trees: number; leaves: number; day: number }

async function seedCrew(db: DB, crew: Crew, blockId: string) {
  // Each device keeps its own chain. Trees are split across the crew member's devices by day.
  const chains = new Map<string, { prev: string; events: TreeEvent[]; clock: number }>();
  for (const [i, d] of crew.devices.entries()) {
    chains.set(d.id, { prev: '', events: [], clock: Date.parse(`2026-10-${String(5 + crew.day + i).padStart(2, '0')}T15:10:00Z`) });
  }
  let tagN = 0; let leaveN = 0;
  const created: { treeId: string; device: string }[] = [];
  const total = crew.trees + crew.leaves;
  const leaveSlots = new Set<number>();
  while (leaveSlots.size < crew.leaves) leaveSlots.add(Math.floor(rand() * total));

  const add = async (device: string, treeId: string, seq: number, type: TreeEvent['type'], payload: Record<string, unknown>, gapMin: [number, number]) => {
    const c = chains.get(device)!;
    c.clock += Math.round(between(gapMin[0], gapMin[1]) * 60_000);
    const e = await makeEvent({ treeId, seq, type, payload, userId: crew.userId, deviceId: device, prevHash: c.prev, createdAt: new Date(c.clock).toISOString() });
    c.prev = e.hash; c.events.push(e);
    return e;
  };

  for (let i = 0; i < total; i++) {
    const device = crew.devices[Math.floor((i / total) * crew.devices.length)].id;
    const leave = leaveSlots.has(i);
    const tagNumber = leave ? ++leaveN : ++tagN;
    const tag = formatTag(crew.prefix, tagNumber, { leave });
    const pos = randomPointInBlock();
    const treeId = uuid();
    await add(device, treeId, 1, 'create', {
      tag, tagNumber, prefix: crew.prefix, blockId,
      position: { ...pos, accuracyM: round1(between(2.2, 7.5)), fixCount: Math.round(between(6, 24)) },
      fields: makeFields(leave),
    }, [2, 7]);
    created.push({ treeId, device });
  }

  // A few corrections, voids and status changes recorded later in the field.
  const seqs = new Map<string, number>(created.map((c) => [c.treeId, 1]));
  const nextSeq = (id: string) => { const n = (seqs.get(id) ?? 1) + 1; seqs.set(id, n); return n; };
  const sample = (n: number) => created.slice().sort(() => rand() - 0.5).slice(0, n);
  for (const c of sample(Math.round(total / 15))) {
    await add(c.device, c.treeId, nextSeq(c.treeId), 'update', { fields: { heightM: round1(between(16, 34)), heightSource: 'clinometer' } }, [1, 3]);
  }
  for (const c of sample(Math.max(1, Math.round(total / 40)))) {
    await add(c.device, c.treeId, nextSeq(c.treeId), 'void', { reason: pick([['duplicate tag', 2], ['wrong tree flagged', 1], ['outside block', 1]]) }, [1, 4]);
  }
  for (const c of sample(Math.round(total / 18))) {
    const status = pick<'cut' | 'damaged'>([['cut', 2], ['damaged', 1]]);
    await add(c.device, c.treeId, nextSeq(c.treeId), 'status', status === 'cut' ? { status, stumpDiameterCm: Math.round(between(30, 70)) } : { status }, [5, 20]);
  }

  for (const d of crew.devices) {
    const c = chains.get(d.id)!;
    const res = await pushEvents(db, crew.userId, { deviceId: d.id, deviceName: d.name, events: c.events });
    if (res.rejected.length) throw new Error(`Seed events rejected: ${JSON.stringify(res.rejected.slice(0, 3))}`);
    console.log(`  ${d.name}: ${res.accepted.length} events`);
  }
  return created;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const { db, sql } = createDb(url);
  try {
    console.log('Resetting tables...');
    await db.execute(dsql`truncate table events, trees, blocks, scenarios, devices, users restart identity cascade`);

    const joe = await createUser(db, { email: 'joe@example.com', name: 'Joe Hughes', password: 'timber123', tagPrefix: 'J' });
    const sam = await createUser(db, { email: 'sam@example.com', name: 'Sam Kowalski', password: 'timber123', tagPrefix: 'S' });
    console.log(`Users: ${joe.email} (J), ${sam.email} (S)  password: timber123`);

    const blockId = uuid();
    await pushEvents(db, joe.id, {
      deviceId: 'joe-iphone', deviceName: "Joe's iPhone 15", events: [],
      blocks: [{ id: blockId, name: 'CB12 Paul Lake Rd', code: 'CB12', boundary: CB12_BOUNDARY, createdBy: joe.id, createdAt: '2026-10-05T14:00:00.000Z' }],
    });
    console.log(`Block CB12: ${polygonAreaHa(CB12_BOUNDARY).toFixed(1)} ha`);

    console.log('Trees:');
    const joeTrees = await seedCrew(db, { userId: joe.id, prefix: 'J', devices: [{ id: 'joe-iphone', name: "Joe's iPhone 15" }, { id: 'joe-ipad', name: "Joe's iPad mini" }], trees: 74, leaves: 4, day: 0 }, blockId);
    await seedCrew(db, { userId: sam.id, prefix: 'S', devices: [{ id: 'sam-iphone', name: "Sam's iPhone 13" }], trees: 40, leaves: 2, day: 1 }, blockId);

    // Two office corrections by Sam through the dashboard path (deviceId "web").
    await appendWebEvent(db, sam.id, joeTrees[3].treeId, 'update', { fields: { dbhCm: 46, notes: 'DBH re-taped in office review' } });
    await appendWebEvent(db, joe.id, joeTrees[8].treeId, 'update', { fields: { straightness: 5 } });

    const base: Scenario = { ...DEFAULT_SCENARIO, id: uuid(), name: 'Placeholder prices', updatedAt: new Date().toISOString() };
    const strict: Scenario = {
      ...base, id: uuid(), name: 'Strict pole spec',
      poleSpec: { ...base.poleSpec, minStraightness: 5, minTwist: 5, minBranchiness: 4 },
    };
    const nov: Scenario = {
      ...base, id: uuid(), name: 'Nov sawlog +10%',
      sawlogPricePerM3: Object.fromEntries(Object.entries(base.sawlogPricePerM3).map(([k, v]) => [k, Math.round((v ?? 0) * 1.1)])),
    };
    for (const sc of [base, strict, nov]) {
      await db.insert(scenarios).values({ id: sc.id, name: sc.name, data: sc as unknown as Record<string, unknown>, createdBy: joe.id, updatedAt: sc.updatedAt });
    }
    const [{ count }] = (await db.execute(dsql`select count(*)::int as count from trees`)) as unknown as { count: number }[];
    const [{ ev }] = (await db.execute(dsql`select count(*)::int as ev from events`)) as unknown as { ev: number }[];
    console.log(`Done: ${count} trees from ${ev} events, 3 pricing scenarios.`);
  } finally {
    await sql.end();
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
