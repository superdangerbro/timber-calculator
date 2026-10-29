import { describe, expect, it } from 'vitest';
import { makeEvent, type Block } from '@timber/core';
import { IdbStore } from '../src/platform/storage.idb';
import { dbName } from './helpers';

async function ev(n: number, prevHash = '') {
  return makeEvent({
    treeId: `tree-${n}`,
    seq: 1,
    type: 'create',
    payload: { tag: `J-000${n}`, tagNumber: n, prefix: 'J', position: { lat: 50.7, lon: -120.35, accuracyM: 3, fixCount: 4 }, fields: { species: 'FD' } },
    userId: 'u',
    deviceId: 'd',
    prevHash,
    createdAt: new Date(Date.UTC(2026, 9, 27, 12, 0, n)).toISOString(),
  });
}

describe('IndexedDB store', () => {
  it('round-trips events with synced flags, idempotently', async () => {
    const name = dbName();
    const s = new IdbStore(name);
    await s.init();
    const e1 = await ev(1);
    const e2 = await ev(2, e1.hash);
    await s.putEvents([e1, e2], false);
    await s.putEvents([e1], false); // duplicate
    expect(await s.allEvents()).toHaveLength(2);
    expect((await s.unsyncedEvents()).map((e) => e.id).sort()).toEqual([e1.id, e2.id].sort());
    await s.markSynced([e1.id]);
    expect((await s.unsyncedEvents()).map((e) => e.id)).toEqual([e2.id]);
    // Pulling an event we already have marks it synced; never downgrades.
    await s.putEvents([e2], true);
    await s.putEvents([e1], false);
    expect(await s.unsyncedEvents()).toEqual([]);
    s.close();
    const again = new IdbStore(name);
    await again.init();
    const all = await again.allEvents();
    expect(all.find((x) => x.event.id === e2.id)?.event).toEqual(e2);
    expect(all.every((x) => x.synced)).toBe(true);
  });

  it('stores blocks, settings, tile regions and tiles', async () => {
    const s = new IdbStore(dbName());
    await s.init();
    const block: Block = {
      id: 'b1',
      name: 'CB12',
      code: 'CB12',
      boundary: { type: 'Polygon', coordinates: [[[-120.36, 50.69], [-120.34, 50.69], [-120.34, 50.71], [-120.36, 50.69]]] },
      createdBy: 'u',
      createdAt: new Date().toISOString(),
    };
    await s.putBlock(block);
    expect(await s.getBlocks()).toEqual([block]);
    await s.setSetting('syncCursor', '42');
    expect(await s.getSetting('syncCursor')).toBe('42');
    expect(await s.getSetting('nope')).toBeUndefined();
    await s.putRegion({ id: 'b1', name: 'CB12', bbox: [-120.36, 50.69, -120.34, 50.71], minZoom: 12, maxZoom: 17, tileCount: 1, bytes: 3, source: 'esri', createdAt: '' });
    await s.putTile('b1', 'esri/12/1/2', new Uint8Array([1, 2, 3]).buffer);
    expect(new Uint8Array((await s.getTile('esri/12/1/2'))!)).toEqual(new Uint8Array([1, 2, 3]));
    await s.deleteRegion('b1');
    expect(await s.getTile('esri/12/1/2')).toBeUndefined();
    expect(await s.getRegions()).toEqual([]);
    await s.deleteBlock('b1');
    expect(await s.getBlocks()).toEqual([]);
  });
});
