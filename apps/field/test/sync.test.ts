import { describe, expect, it, vi } from 'vitest';
import { makeEvent, verifyChain, type TreeEvent } from '@timber/core';
import { IdbStore } from '../src/platform/storage.idb';
import { Repo } from '../src/state/repo';
import { SyncClient } from '../src/sync/client';
import { dbName } from './helpers';

const pos = { lat: 50.7, lon: -120.35, accuracyM: 3, fixCount: 5 };

/** In-memory stand-in for apps/web's sync API. */
function fakeServer() {
  const events: TreeEvent[] = [];
  const pushes: TreeEvent[][] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
    if (u.pathname === '/api/auth/token') {
      const body = JSON.parse(String(init?.body));
      if (body.password !== 'timber123') return new Response(JSON.stringify({ error: 'Invalid login' }), { status: 401 });
      return Response.json({ token: 'tok', user: { id: 'user-joe', email: body.email, name: 'Joe', tagPrefix: 'J' } });
    }
    if (auth !== 'Bearer tok') return new Response('{}', { status: 401 });
    if (u.pathname === '/api/sync/push') {
      const body = JSON.parse(String(init?.body));
      pushes.push(body.events);
      const accepted: string[] = [];
      const rejected: { id: string; reason: string }[] = [];
      // Like apps/web: events must belong to the token's user and extend a known chain.
      for (const e of body.events as TreeEvent[]) {
        if (events.some((x) => x.id === e.id)) {
          accepted.push(e.id);
          continue;
        }
        if (e.userId !== 'user-joe') {
          rejected.push({ id: e.id, reason: 'userId does not match the authenticated user' });
          continue;
        }
        if (e.prevHash && !events.some((x) => x.hash === e.prevHash)) {
          rejected.push({ id: e.id, reason: 'broken chain' });
          continue;
        }
        events.push(e);
        accepted.push(e.id);
      }
      return Response.json({ accepted, rejected });
    }
    if (u.pathname === '/api/sync/pull') {
      const since = Number(u.searchParams.get('since') || 0);
      const page = events.slice(since);
      return Response.json({ events: page, blocks: [], scenarios: [], cursor: String(events.length) });
    }
    return new Response('nope', { status: 404 });
  });
  return { events, pushes, fetchMock };
}

async function setup() {
  const repo = await Repo.open(new IdbStore(dbName()));
  const server = fakeServer();
  const sync = new SyncClient(repo, server.fetchMock as unknown as typeof fetch, () => true);
  await sync.signIn('http://server.test', 'joe@example.com', 'timber123');
  return { repo, sync, server };
}

describe('sync client', () => {
  it('signs in and adopts the account tag prefix', async () => {
    const { repo } = await setup();
    expect(repo.settings.token).toBe('tok');
    expect(repo.settings.user?.tagPrefix).toBe('J');
  });

  it('rejects a bad password', async () => {
    const repo = await Repo.open(new IdbStore(dbName()));
    const server = fakeServer();
    const sync = new SyncClient(repo, server.fetchMock as unknown as typeof fetch, () => true);
    await expect(sync.signIn('http://server.test', 'joe@example.com', 'wrong')).rejects.toThrow(/invalid/i);
  });

  it('pushes only unsynced events, marks them synced, idempotent on retry', async () => {
    const { repo, sync, server } = await setup();
    await repo.createTree({ species: 'FD', dbhCm: 40 }, pos);
    await repo.createTree({ species: 'PL', dbhCm: 30 }, pos);
    await sync.sync();
    expect(server.pushes).toHaveLength(1);
    expect(server.pushes[0]).toHaveLength(2);
    expect(repo.getState().unsyncedCount).toBe(0);
    expect(await repo.store.unsyncedEvents()).toEqual([]);

    await repo.voidTree(repo.getState().trees[0].id, 'x');
    await sync.sync();
    expect(server.pushes).toHaveLength(2);
    expect(server.pushes[1].map((e) => e.type)).toEqual(['void']);

    await sync.sync(); // nothing new
    expect(server.pushes).toHaveLength(2);
    expect(server.events).toHaveLength(3);
    expect(sync.getState().status).toBe('ok');
  });

  it('pulls events from other devices and merges them', async () => {
    const { repo, sync, server } = await setup();
    const other = await makeEvent({
      treeId: 'office-tree',
      seq: 1,
      type: 'create',
      payload: { tag: 'K-0007', tagNumber: 7, prefix: 'K', position: pos, fields: { species: 'LW', dbhCm: 38, heightM: 24 } },
      userId: 'user-kim',
      deviceId: 'kims-phone',
      prevHash: '',
    });
    server.events.push(other);
    const local = await repo.createTree({ species: 'FD', dbhCm: 40 }, pos);
    await sync.sync();
    const trees = repo.getState().trees;
    expect(trees.map((t) => t.tag).sort()).toEqual(['J-0001', 'K-0007']);
    expect(await repo.store.getSetting('syncCursor')).toBe('2');

    // Office edit to our tree comes back down and folds in.
    const edit = await makeEvent({
      treeId: local.id,
      seq: 2,
      type: 'update',
      payload: { fields: { heightM: 31 } },
      userId: 'user-joe',
      deviceId: 'web',
      prevHash: '',
    });
    server.events.push(edit);
    await sync.sync();
    expect(repo.tree(local.id)?.heightM).toBe(31);
    // Pulling the same events again changes nothing.
    await repo.ingest([other, edit]);
    expect(repo.getState().events).toHaveLength(3);
    // Our own tags still continue from our own numbers, not K's.
    expect(repo.peekTag(false).tag).toBe('J-0002');
  });

  it('re-signs trees tallied before the first sign-in so the server accepts them', async () => {
    const repo = await Repo.open(new IdbStore(dbName()));
    const server = fakeServer();
    const sync = new SyncClient(repo, server.fetchMock as unknown as typeof fetch, () => true);
    const t1 = await repo.createTree({ species: 'FD', dbhCm: 40 }, pos);
    await repo.voidTree(t1.id, 'oops');
    await repo.createTree({ species: 'PL', dbhCm: 30 }, pos);
    expect(repo.getState().events.every((e) => e.event.userId.startsWith('local-'))).toBe(true);

    await sync.signIn('http://server.test', 'joe@example.com', 'timber123');
    const events = repo.getState().events.map((e) => e.event);
    expect(events.every((e) => e.userId === 'user-joe')).toBe(true);
    expect((await verifyChain(events)).ok).toBe(true);
    expect(repo.getState().trees.map((t) => t.tag).sort()).toEqual(['J-0001', 'J-0002']);

    await sync.sync();
    expect(sync.getState().lastError).toBeNull();
    expect(server.events).toHaveLength(3);
    expect(repo.getState().unsyncedCount).toBe(0);
    // A new tree after sign-in chains on correctly too.
    await repo.createTree({ species: 'SX', dbhCm: 33 }, pos);
    await sync.sync();
    expect(server.events).toHaveLength(4);
    // Sign out: new events still carry the account id, not a placeholder.
    await sync.signOut();
    await repo.createTree({ species: 'SX', dbhCm: 33 }, pos);
    expect(repo.getState().events.at(-1)!.event.userId).toBe('user-joe');
  });

  it('reports offline without calling the server', async () => {
    const repo = await Repo.open(new IdbStore(dbName()));
    const server = fakeServer();
    let online = true;
    const sync = new SyncClient(repo, server.fetchMock as unknown as typeof fetch, () => online);
    await sync.signIn('http://server.test', 'joe@example.com', 'timber123');
    online = false;
    server.fetchMock.mockClear();
    await repo.createTree({ species: 'FD', dbhCm: 40 }, pos);
    await sync.sync();
    expect(server.fetchMock).not.toHaveBeenCalled();
    expect(sync.getState().status).toBe('offline');
    expect(repo.getState().unsyncedCount).toBe(1);
  });

  it('a failed push keeps events unsynced for the next try', async () => {
    const { repo, sync, server } = await setup();
    await repo.createTree({ species: 'FD', dbhCm: 40 }, pos);
    server.fetchMock.mockImplementationOnce(async () => {
      throw new TypeError('Failed to fetch');
    });
    await sync.sync();
    expect(sync.getState().status).toBe('offline');
    expect(repo.getState().unsyncedCount).toBe(1);
    await sync.sync();
    expect(repo.getState().unsyncedCount).toBe(0);
  });
});
