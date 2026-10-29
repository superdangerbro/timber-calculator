import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Block, TreeEvent } from '@timber/core';
import type { LocalStore, StoredEvent, StoredPhoto, TileRegion } from './types';

interface TimberDB extends DBSchema {
  events: { key: string; value: { id: string; event: TreeEvent; synced: 0 | 1 }; indexes: { synced: number } };
  blocks: { key: string; value: Block };
  settings: { key: string; value: { key: string; value: unknown } };
  regions: { key: string; value: TileRegion };
  tiles: { key: string; value: { key: string; regionId: string; data: ArrayBuffer }; indexes: { region: string } };
  photos: { key: string; value: Omit<StoredPhoto, 'synced'> & { synced: 0 | 1 }; indexes: { synced: number } };
}

/** Web / desktop / test storage: IndexedDB via idb. */
export class IdbStore implements LocalStore {
  private db!: IDBPDatabase<TimberDB>;
  constructor(private name = 'timber-field') {}

  async init() {
    if (this.db) return;
    this.db = await openDB<TimberDB>(this.name, 2, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const ev = db.createObjectStore('events', { keyPath: 'id' });
          ev.createIndex('synced', 'synced');
          db.createObjectStore('blocks', { keyPath: 'id' });
          db.createObjectStore('settings', { keyPath: 'key' });
          db.createObjectStore('regions', { keyPath: 'id' });
          const tiles = db.createObjectStore('tiles', { keyPath: 'key' });
          tiles.createIndex('region', 'regionId');
        }
        if (oldVersion < 2) {
          const ph = db.createObjectStore('photos', { keyPath: 'id' });
          ph.createIndex('synced', 'synced');
        }
      },
    });
  }

  close() {
    this.db?.close();
  }

  async putEvents(events: TreeEvent[], synced: boolean) {
    const tx = this.db.transaction('events', 'readwrite');
    for (const e of events) {
      const existing = await tx.store.get(e.id);
      if (existing) {
        if (synced && !existing.synced) await tx.store.put({ ...existing, synced: 1 });
        continue;
      }
      await tx.store.put({ id: e.id, event: e, synced: synced ? 1 : 0 });
    }
    await tx.done;
  }
  async replaceEvents(events: TreeEvent[]) {
    const tx = this.db.transaction('events', 'readwrite');
    for (const e of events) await tx.store.put({ id: e.id, event: e, synced: 0 });
    await tx.done;
  }
  async allEvents(): Promise<StoredEvent[]> {
    const rows = await this.db.getAll('events');
    return rows.map((r) => ({ event: r.event, synced: !!r.synced }));
  }
  async unsyncedEvents() {
    const rows = await this.db.getAllFromIndex('events', 'synced', 0);
    return rows.map((r) => r.event);
  }
  async markSynced(ids: string[]) {
    const tx = this.db.transaction('events', 'readwrite');
    for (const id of ids) {
      const r = await tx.store.get(id);
      if (r && !r.synced) await tx.store.put({ ...r, synced: 1 });
    }
    await tx.done;
  }
  async getBlocks() {
    return this.db.getAll('blocks');
  }
  async putBlock(block: Block) {
    await this.db.put('blocks', block);
  }
  async deleteBlock(id: string) {
    await this.db.delete('blocks', id);
  }
  async getSetting<T>(key: string) {
    const r = await this.db.get('settings', key);
    return r?.value as T | undefined;
  }
  async setSetting<T>(key: string, value: T) {
    await this.db.put('settings', { key, value });
  }
  async getRegions() {
    return this.db.getAll('regions');
  }
  async putRegion(region: TileRegion) {
    await this.db.put('regions', region);
  }
  async deleteRegion(id: string) {
    const tx = this.db.transaction(['regions', 'tiles'], 'readwrite');
    await tx.objectStore('regions').delete(id);
    const idx = tx.objectStore('tiles').index('region');
    let cur = await idx.openCursor(id);
    while (cur) {
      await cur.delete();
      cur = await cur.continue();
    }
    await tx.done;
  }
  async putTile(regionId: string, key: string, data: ArrayBuffer) {
    await this.db.put('tiles', { key, regionId, data });
  }
  async getTile(key: string) {
    return (await this.db.get('tiles', key))?.data;
  }
  async putPhoto(photo: StoredPhoto) {
    const existing = await this.db.get('photos', photo.id);
    await this.db.put('photos', { ...photo, synced: photo.synced || existing?.synced ? 1 : 0 });
  }
  async getPhoto(id: string) {
    const r = await this.db.get('photos', id);
    return r ? { ...r, synced: !!r.synced } : undefined;
  }
  async unsyncedPhotos() {
    const rows = await this.db.getAllFromIndex('photos', 'synced', 0);
    return rows.map((r) => ({ ...r, synced: false }));
  }
  async markPhotoSynced(id: string) {
    const r = await this.db.get('photos', id);
    if (r && !r.synced) await this.db.put('photos', { ...r, synced: 1 });
  }
}
