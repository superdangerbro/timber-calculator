// Sync + event-store logic, shared by the API routes, the seed script and the tests.
import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import {
  foldEvents, hashEvent, makeEvent, verifyChain,
  type Block, type SyncPullResponse, type SyncPushResponse, type Tree, type TreeEvent,
} from '@timber/core';
import type { DB } from '@/db';
import { blocks, devices, events, scenarios, trees } from '@/db/schema';
import { eventToRow, rowToBlock, rowToEvent, rowToScenario, rowToTree, treeToRow } from './rows';
import { blockSchema, eventSchema, pushSchema } from './validate';

export const WEB_DEVICE_ID = 'web';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function touchDevice(db: DB, deviceId: string, userId: string, name?: string) {
  await db.insert(devices)
    .values({ id: deviceId, userId, name: name ?? null, lastSeen: new Date() })
    .onConflictDoUpdate({
      target: devices.id,
      set: { lastSeen: new Date(), userId, ...(name ? { name } : {}) },
    });
}

/**
 * Store pushed events. Idempotent on event id. Every event's hash is recomputed and
 * its prevHash must link to an event already known from the same device (or '' for the
 * first event of a device). Events may arrive in any order within a batch.
 */
export async function pushEvents(db: DB, userId: string, body: unknown): Promise<SyncPushResponse> {
  const parsed = pushSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, 'Invalid push body: ' + parsed.error.issues[0]?.message);
  const req = parsed.data;
  if (req.deviceId === WEB_DEVICE_ID) throw new HttpError(400, 'deviceId "web" is reserved');

  const accepted: string[] = [];
  const rejected: { id: string; reason: string }[] = [];
  const valid: TreeEvent[] = [];

  for (const raw of req.events) {
    const r = eventSchema.safeParse(raw);
    const id = typeof (raw as { id?: unknown })?.id === 'string' ? (raw as { id: string }).id : '?';
    if (!r.success) { rejected.push({ id, reason: 'invalid event: ' + r.error.issues[0]?.path.join('.') + ' ' + r.error.issues[0]?.message }); continue; }
    const e = r.data as TreeEvent;
    if (e.userId !== userId) { rejected.push({ id: e.id, reason: 'userId does not match the authenticated user' }); continue; }
    if (e.deviceId === WEB_DEVICE_ID) { rejected.push({ id: e.id, reason: 'deviceId "web" is reserved' }); continue; }
    const { hash, ...rest } = e;
    const recomputed = await hashEvent(rest);
    if (recomputed !== hash) { rejected.push({ id: e.id, reason: 'hash mismatch (event was modified)' }); continue; }
    valid.push(e);
  }

  await touchDevice(db, req.deviceId, userId, req.deviceName);
  if (req.blocks?.length) await upsertBlocks(db, userId, req.blocks as Block[]);

  const touchedTrees = new Set<string>();
  await db.transaction(async (tx) => {
    // Serialize pushes so chain checks see a consistent view.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('timber-events'))`);

    const ids = valid.map((e) => e.id);
    const existing = ids.length
      ? await tx.select({ id: events.id, hash: events.hash }).from(events).where(inArray(events.id, ids))
      : [];
    const existingHash = new Map(existing.map((x) => [x.id, x.hash]));

    const deviceIds = [...new Set(valid.map((e) => e.deviceId))];
    const prevs = [...new Set(valid.map((e) => e.prevHash).filter(Boolean))];
    const knownRows = prevs.length
      ? await tx.select({ hash: events.hash, deviceId: events.deviceId }).from(events)
          .where(and(inArray(events.hash, prevs), inArray(events.deviceId, deviceIds)))
      : [];
    const known = new Set(knownRows.map((k) => `${k.deviceId}|${k.hash}`));

    let pending = valid.filter((e) => {
      const h = existingHash.get(e.id);
      if (h === undefined) return true;
      if (h === e.hash) accepted.push(e.id);
      else rejected.push({ id: e.id, reason: 'conflict: an event with this id but a different hash exists' });
      return false;
    });
    for (const e of valid) if (existingHash.get(e.id) === e.hash) known.add(`${e.deviceId}|${e.hash}`);

    const toInsert: TreeEvent[] = [];
    let progress = true;
    while (pending.length && progress) {
      progress = false;
      const next: TreeEvent[] = [];
      for (const e of pending) {
        if (e.prevHash === '' || known.has(`${e.deviceId}|${e.prevHash}`)) {
          toInsert.push(e);
          known.add(`${e.deviceId}|${e.hash}`);
          progress = true;
        } else next.push(e);
      }
      pending = next;
    }
    for (const e of pending) rejected.push({ id: e.id, reason: 'broken chain: prevHash does not match any known event from this device' });

    if (toInsert.length) {
      // Insert in chain order so server_seq follows device order.
      for (let i = 0; i < toInsert.length; i += 500) {
        await tx.insert(events).values(toInsert.slice(i, i + 500).map(eventToRow)).onConflictDoNothing();
      }
      for (const e of toInsert) { accepted.push(e.id); touchedTrees.add(e.treeId); }
    }
    if (touchedTrees.size) await refreshTrees(tx as unknown as DB, [...touchedTrees]);
  });

  return { accepted, rejected };
}

/** Re-fold the materialized trees rows from their events. */
export async function refreshTrees(db: DB, treeIds: string[]): Promise<Tree[]> {
  if (!treeIds.length) return [];
  const rows = await db.select().from(events).where(inArray(events.treeId, treeIds)).orderBy(asc(events.serverSeq));
  const byTree = new Map<string, TreeEvent[]>();
  for (const r of rows) {
    const list = byTree.get(r.treeId) ?? [];
    list.push(rowToEvent(r));
    byTree.set(r.treeId, list);
  }
  const out: Tree[] = [];
  for (const id of treeIds) {
    const evts = byTree.get(id) ?? [];
    const tree = evts.length ? foldEvents(evts) : null;
    if (!tree) {
      await db.delete(trees).where(eq(trees.id, id));
      continue;
    }
    const row = treeToRow(tree);
    await db.insert(trees).values(row).onConflictDoUpdate({ target: trees.id, set: row });
    out.push(tree);
  }
  return out;
}

export async function pullEvents(db: DB, since: string | null | undefined, limit = 2000): Promise<SyncPullResponse & { hasMore: boolean }> {
  const n = Number(since ?? 0);
  const from = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  const rows = await db.select().from(events).where(gt(events.serverSeq, from)).orderBy(asc(events.serverSeq)).limit(limit + 1);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const cursor = page.length ? String(page[page.length - 1].serverSeq) : String(from);
  const [b, s] = await Promise.all([db.select().from(blocks), db.select().from(scenarios)]);
  return { events: page.map(rowToEvent), blocks: b.map(rowToBlock), scenarios: s.map(rowToScenario), cursor, hasMore };
}

export async function upsertBlocks(db: DB, userId: string, list: Block[]) {
  for (const raw of list) {
    const b = blockSchema.parse(raw);
    const row = {
      id: b.id, name: b.name, code: b.code ?? null, boundary: b.boundary as Block['boundary'],
      createdBy: b.createdBy ?? userId, createdAt: b.createdAt ?? new Date().toISOString(),
    };
    await db.insert(blocks).values(row).onConflictDoUpdate({ target: blocks.id, set: { name: row.name, code: row.code, boundary: row.boundary } });
  }
}

/**
 * Append a dashboard edit (update / void / status) to a tree. All web edits share one
 * hash chain under deviceId "web"; createdAt is kept strictly increasing along it.
 */
export async function appendWebEvent(
  db: DB, userId: string, treeId: string, type: 'update' | 'void' | 'status', payload: Record<string, unknown>,
): Promise<{ event: TreeEvent; tree: Tree | null }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('timber-events'))`);
    const [maxRow] = await tx.select({ max: sql<number>`max(${events.seq})` }).from(events).where(eq(events.treeId, treeId));
    if (!maxRow?.max) throw new HttpError(404, 'Tree not found');
    const [last] = await tx.select({ hash: events.hash, createdAt: events.createdAt }).from(events)
      .where(eq(events.deviceId, WEB_DEVICE_ID)).orderBy(desc(events.serverSeq)).limit(1);
    let ts = Date.now();
    if (last) ts = Math.max(ts, Date.parse(last.createdAt) + 1);
    const event = await makeEvent({
      treeId, seq: Number(maxRow.max) + 1, type, payload, userId, deviceId: WEB_DEVICE_ID,
      prevHash: last?.hash ?? '', createdAt: new Date(ts).toISOString(),
    });
    await tx.insert(events).values(eventToRow(event));
    const [tree] = await refreshTrees(tx as unknown as DB, [treeId]);
    return { event, tree: tree ?? null };
  });
}

/** A tree's events plus whether every device chain they belong to verifies. */
export async function treeHistory(db: DB, treeId: string) {
  const rows = await db.select().from(events).where(eq(events.treeId, treeId)).orderBy(asc(events.serverSeq));
  if (!rows.length) throw new HttpError(404, 'Tree not found');
  const deviceIds = [...new Set(rows.map((r) => r.deviceId))];
  const chainRows = await db.select().from(events).where(inArray(events.deviceId, deviceIds)).orderBy(asc(events.serverSeq));
  const verification = await verifyChain(chainRows.map(rowToEvent));
  return { events: rows.map((r) => ({ ...rowToEvent(r), serverSeq: r.serverSeq, receivedAt: r.receivedAt.toISOString() })), verification };
}

export async function listTrees(db: DB): Promise<Tree[]> {
  const rows = await db.select().from(trees).orderBy(asc(trees.prefix), asc(trees.tagNumber));
  return rows.map(rowToTree);
}
