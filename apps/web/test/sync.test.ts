import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql as dsql } from 'drizzle-orm';
import { makeEvent, uuid, type TreeEvent } from '@timber/core';
import '../scripts/env';
import { runMigrations } from '../scripts/migrate';
import { createDb, type DB } from '../src/db';
import { trees } from '../src/db/schema';
import { appendWebEvent, pullEvents, pushEvents, treeHistory } from '../src/lib/server/sync';
import { createUser } from '../src/lib/server/users';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://timber:timber@localhost:5432/timber_test';
let db: DB; let close: () => Promise<void>;
let userId: string; let otherId: string;

beforeAll(async () => {
  await runMigrations(url);
  const c = createDb(url); db = c.db; close = () => c.sql.end();
});
afterAll(async () => { await close(); });
beforeEach(async () => {
  await db.execute(dsql`truncate table events, trees, blocks, scenarios, devices, users restart identity cascade`);
  userId = (await createUser(db, { email: 'joe@example.com', name: 'Joe', password: 'timber123', tagPrefix: 'J' })).id;
  otherId = (await createUser(db, { email: 'sam@example.com', name: 'Sam', password: 'timber123', tagPrefix: 'S' })).id;
});

/** Builds a device chain: create events for `n` trees, then an update on the first. */
async function chain(n: number, deviceId = 'phone-1', uid = userId) {
  const out: TreeEvent[] = []; let prev = ''; let t = Date.parse('2026-10-05T15:00:00Z');
  const treeIds: string[] = [];
  for (let i = 1; i <= n; i++) {
    const treeId = uuid(); treeIds.push(treeId);
    const e = await makeEvent({
      treeId, seq: 1, type: 'create', userId: uid, deviceId, prevHash: prev, createdAt: new Date((t += 60_000)).toISOString(),
      payload: { tag: `J-${String(i).padStart(4, '0')}`, tagNumber: i, prefix: 'J', position: { lat: 50.7 + i * 1e-4, lon: -120.35, accuracyM: 3, fixCount: 10 },
        fields: { species: 'FD', dbhCm: 40 + i, heightM: 28, straightness: 5, twist: 5, branchiness: 4 } },
    });
    out.push(e); prev = e.hash;
  }
  const u = await makeEvent({ treeId: treeIds[0], seq: 2, type: 'update', payload: { fields: { dbhCm: 55 } }, userId: uid, deviceId, prevHash: prev, createdAt: new Date((t += 60_000)).toISOString() });
  out.push(u);
  return { events: out, treeIds };
}
const countTrees = async () => (await db.select().from(trees)).length;

describe('sync push', () => {
  it('stores events, materializes trees and is idempotent', async () => {
    const { events, treeIds } = await chain(3);
    const r1 = await pushEvents(db, userId, { deviceId: 'phone-1', events });
    expect(r1.rejected).toEqual([]);
    expect(r1.accepted).toHaveLength(4);
    expect(await countTrees()).toBe(3);
    const first = (await db.select().from(trees)).find((t) => t.id === treeIds[0])!;
    expect(first.dbhCm).toBe(55);
    expect(first.version).toBe(2);

    const r2 = await pushEvents(db, userId, { deviceId: 'phone-1', events });
    expect(r2.rejected).toEqual([]);
    expect(r2.accepted.sort()).toEqual(events.map((e) => e.id).sort());
    const pulled = await pullEvents(db, '0');
    expect(pulled.events).toHaveLength(4); // no duplicates
    expect(await countTrees()).toBe(3);
  });

  it('accepts a batch sent out of order', async () => {
    const { events } = await chain(3);
    const r = await pushEvents(db, userId, { deviceId: 'phone-1', events: [...events].reverse() });
    expect(r.rejected).toEqual([]);
    expect(r.accepted).toHaveLength(4);
  });

  it('rejects tampered events (hash mismatch) and keeps the rest', async () => {
    const { events } = await chain(2);
    const tampered = { ...events[1], payload: { ...events[1].payload, fields: { species: 'FD', dbhCm: 99 } } };
    const r = await pushEvents(db, userId, { deviceId: 'phone-1', events: [events[0], tampered] });
    expect(r.accepted).toEqual([events[0].id]);
    expect(r.rejected).toEqual([{ id: events[1].id, reason: expect.stringMatching(/hash mismatch/) }]);
    // The update after the rejected event no longer links to a known event either.
    const r2 = await pushEvents(db, userId, { deviceId: 'phone-1', events: [events[2]] });
    expect(r2.rejected[0].reason).toMatch(/broken chain/);
    expect(await countTrees()).toBe(1);
  });

  it('rejects a forged event whose hash was recomputed but whose id collides', async () => {
    const { events } = await chain(1);
    await pushEvents(db, userId, { deviceId: 'phone-1', events });
    const forged = await makeEvent({ ...events[0], payload: { ...events[0].payload, fields: { species: 'PL', dbhCm: 20 } } });
    const r = await pushEvents(db, userId, { deviceId: 'phone-1', events: [forged] });
    expect(r.rejected[0].reason).toMatch(/conflict/);
  });

  it('rejects events claiming another user', async () => {
    const { events } = await chain(1, 'phone-2', otherId);
    const r = await pushEvents(db, userId, { deviceId: 'phone-2', events });
    expect(r.accepted).toEqual([]);
    expect(r.rejected[0].reason).toMatch(/userId/);
  });

  it('rejects malformed bodies', async () => {
    await expect(pushEvents(db, userId, { events: [] })).rejects.toThrow(/Invalid push body/);
    const r = await pushEvents(db, userId, { deviceId: 'p', events: [{ id: 'nope' }] });
    expect(r.rejected[0].reason).toMatch(/invalid event/);
  });
});

describe('sync pull', () => {
  it('pages with a cursor and returns only newer events', async () => {
    const { events } = await chain(5);
    await pushEvents(db, userId, { deviceId: 'phone-1', events });
    const p1 = await pullEvents(db, null, 4);
    expect(p1.events).toHaveLength(4);
    expect(p1.hasMore).toBe(true);
    const p2 = await pullEvents(db, p1.cursor, 4);
    expect(p2.events).toHaveLength(2);
    expect(p2.hasMore).toBe(false);
    expect(new Set([...p1.events, ...p2.events].map((e) => e.id)).size).toBe(6);
    const p3 = await pullEvents(db, p2.cursor);
    expect(p3.events).toHaveLength(0);
    expect(p3.cursor).toBe(p2.cursor);

    const more = await chain(1, 'phone-9');
    await pushEvents(db, userId, { deviceId: 'phone-9', events: more.events });
    const p4 = await pullEvents(db, p2.cursor);
    expect(p4.events.map((e) => e.id)).toEqual(more.events.map((e) => e.id));
    // pulled events still verify
    expect(p4.events[0].hash).toBe(more.events[0].hash);
  });
});

describe('dashboard edits', () => {
  it('appends hash-chained web events and history verifies', async () => {
    const { events, treeIds } = await chain(2);
    await pushEvents(db, userId, { deviceId: 'phone-1', events });
    const a = await appendWebEvent(db, otherId, treeIds[1], 'update', { fields: { heightM: 31.5 } });
    const b = await appendWebEvent(db, userId, treeIds[1], 'status', { status: 'cut' });
    expect(a.event.deviceId).toBe('web');
    expect(b.event.prevHash).toBe(a.event.hash);
    expect(b.event.seq).toBe(3);
    expect(b.tree?.heightM).toBe(31.5);
    expect(b.tree?.status).toBe('cut');
    const v = await appendWebEvent(db, userId, treeIds[1], 'void', { reason: 'dup' });
    expect(v.tree?.voided).toBe(true);
    const h = await treeHistory(db, treeIds[1]);
    expect(h.events.map((e) => e.type)).toEqual(['create', 'update', 'status', 'void']);
    expect(h.verification.ok).toBe(true);
  });

  it('detects tampering in stored history', async () => {
    const { events, treeIds } = await chain(2);
    await pushEvents(db, userId, { deviceId: 'phone-1', events });
    await db.execute(dsql`update events set payload = jsonb_set(payload, '{fields,dbhCm}', '80') where id = ${events[0].id}`);
    const h = await treeHistory(db, treeIds[0]);
    expect(h.verification.ok).toBe(false);
  });

  it('404s for unknown trees', async () => {
    await expect(appendWebEvent(db, userId, uuid(), 'update', { fields: { dbhCm: 1 } })).rejects.toThrow(/not found/i);
  });
});
