import { describe, expect, it, vi } from 'vitest';
import { blobBytes, encodeUnderCap, fitSize, PHOTO_MAX_BYTES, sha256Hex } from '../src/lib/photo';
import { SyncClient } from '../src/sync/client';
import { makeRig } from './helpers';

describe('photo compression policy', () => {
  it('fits the long edge to 1280 and never upscales', () => {
    expect(fitSize(4032, 3024)).toEqual({ width: 1280, height: 960 });
    expect(fitSize(3024, 4032)).toEqual({ width: 960, height: 1280 });
    expect(fitSize(800, 600)).toEqual({ width: 800, height: 600 });
  });
  it('steps quality then size down until under the cap', async () => {
    const calls: [number, number, number][] = [];
    // Fake encoder: bytes ~ pixels × quality.
    const encode = async (w: number, h: number, q: number) => {
      calls.push([w, h, q]);
      return new Blob([new Uint8Array(Math.round(w * h * q * 0.6))], { type: 'image/jpeg' });
    };
    const out = await encodeUnderCap(encode, { width: 1280, height: 960 });
    expect(out.blob.size).toBeLessThanOrEqual(PHOTO_MAX_BYTES);
    expect(calls[0]).toEqual([1280, 960, 0.7]);
    expect(calls.length).toBeGreaterThan(1);
    expect(out.quality).toBeLessThan(0.7);
  });
  it('first try is kept when already small', async () => {
    const encode = vi.fn(async () => new Blob([new Uint8Array(1000)]));
    const out = await encodeUnderCap(encode, { width: 1280, height: 960 });
    expect(encode).toHaveBeenCalledTimes(1);
    expect(out.quality).toBe(0.7);
  });
});

describe('photos: local store, event and sync', () => {
  it('addPhoto stores bytes and records an update event with the sha-256', async () => {
    const { tally, repo, store } = await makeRig();
    await tally.press();
    await tally.hear('fir forty two thirty metres straight four twist four clean');
    await tally.hear('save');
    const tree = repo.getState().trees[0];
    const blob = new Blob([new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9])], { type: 'image/jpeg' });
    const meta = await repo.addPhoto(tree.id, { blob, width: 1280, height: 960, lat: 50.7, lon: -120.35 });
    expect(meta.sha256).toBe(await sha256Hex(await blobBytes(blob)));
    expect(repo.tree(tree.id)?.photos?.[0].id).toBe(meta.id);
    const ev = repo.getState().events.at(-1)!.event;
    expect(ev.type).toBe('update');
    expect((ev.payload.photos as { id: string }[])[0].id).toBe(meta.id);
    expect((await store.unsyncedPhotos()).map((p) => p.id)).toEqual([meta.id]);
  });

  it('sync uploads unsynced photos once, retries failures, and downloads missing ones', async () => {
    const { tally, repo, store } = await makeRig();
    await repo.saveSettings({ token: 'tok', serverUrl: 'http://srv' });
    await tally.press();
    await tally.hear('fir forty two thirty metres straight four twist four clean');
    await tally.hear('save');
    const tree = repo.getState().trees[0];
    const meta = await repo.addPhoto(tree.id, { blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), width: 10, height: 10 });

    const puts: { url: string; headers: Record<string, string> }[] = [];
    let failPut = true;
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/api/sync/push')) {
        const body = JSON.parse(String(init!.body));
        return new Response(JSON.stringify({ accepted: body.events.map((e: { id: string }) => e.id), rejected: [] }), { status: 200 });
      }
      if (url.includes('/api/sync/pull')) return new Response(JSON.stringify({ events: [], blocks: [], scenarios: [], cursor: '1' }), { status: 200 });
      if (url.includes('/api/photos/') && init?.method === 'PUT') {
        puts.push({ url, headers: init.headers as Record<string, string> });
        if (failPut) return new Response('nope', { status: 503 });
        return new Response('{}', { status: 201 });
      }
      if (url.includes('/api/photos/other')) return new Response(new Uint8Array([9, 9]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
      return new Response('{}', { status: 404 });
    });
    const sync = new SyncClient(repo, fetchImpl as unknown as typeof fetch, () => true);
    await sync.sync();
    expect(puts).toHaveLength(1);
    expect(puts[0].headers['X-Sha256']).toBe(meta.sha256);
    expect(puts[0].headers.Authorization).toBe('Bearer tok');
    expect(sync.getState().pendingPhotos).toBe(1);
    failPut = false;
    await sync.sync();
    expect(puts).toHaveLength(2);
    expect(await store.unsyncedPhotos()).toEqual([]);
    await sync.sync();
    expect(puts).toHaveLength(2); // nothing left to upload

    const b = await sync.photoBlob('other');
    expect(b?.size).toBe(2);
    expect((await store.getPhoto('other'))?.synced).toBe(true);
  });
});
