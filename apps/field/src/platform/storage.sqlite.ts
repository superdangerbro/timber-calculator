import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite';
import { Directory, Filesystem } from '@capacitor/filesystem';
import type { Block, TreeEvent } from '@timber/core';
import type { LocalStore, StoredEvent, TileRegion } from './types';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY NOT NULL,
  tree_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  json TEXT NOT NULL,
  synced INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS events_synced ON events (synced);
CREATE TABLE IF NOT EXISTS blocks (id TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS regions (id TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tiles (key TEXT PRIMARY KEY NOT NULL, region_id TEXT NOT NULL, path TEXT NOT NULL);
`;

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(b64: string): ArrayBuffer {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out.buffer;
}

/**
 * iPhone storage: SQLite (survives app updates, not evicted like WebView
 * storage) for events/blocks/settings; map tiles as files in the app's data
 * directory with an index row each.
 */
export class SqliteStore implements LocalStore {
  private sqlite = new SQLiteConnection(CapacitorSQLite);
  private db!: SQLiteDBConnection;

  async init() {
    const consistent = (await this.sqlite.checkConnectionsConsistency()).result;
    const exists = (await this.sqlite.isConnection('timber', false)).result;
    this.db =
      consistent && exists
        ? await this.sqlite.retrieveConnection('timber', false)
        : await this.sqlite.createConnection('timber', false, 'no-encryption', 1, false);
    await this.db.open();
    await this.db.execute(SCHEMA);
  }

  async putEvents(events: TreeEvent[], synced: boolean) {
    if (!events.length) return;
    const set = events.map((e) => ({
      statement: synced
        ? 'INSERT INTO events (id, tree_id, created_at, json, synced) VALUES (?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET synced = 1'
        : 'INSERT OR IGNORE INTO events (id, tree_id, created_at, json, synced) VALUES (?,?,?,?,0)',
      values: [e.id, e.treeId, e.createdAt, JSON.stringify(e)],
    }));
    await this.db.executeSet(set, true);
  }
  async replaceEvents(events: TreeEvent[]) {
    if (!events.length) return;
    await this.db.executeSet(
      events.map((e) => ({
        statement: 'INSERT OR REPLACE INTO events (id, tree_id, created_at, json, synced) VALUES (?,?,?,?,0)',
        values: [e.id, e.treeId, e.createdAt, JSON.stringify(e)],
      })),
      true,
    );
  }
  async allEvents(): Promise<StoredEvent[]> {
    const r = await this.db.query('SELECT json, synced FROM events ORDER BY created_at');
    return (r.values ?? []).map((row) => ({ event: JSON.parse(row.json), synced: !!row.synced }));
  }
  async unsyncedEvents() {
    const r = await this.db.query('SELECT json FROM events WHERE synced = 0 ORDER BY created_at');
    return (r.values ?? []).map((row) => JSON.parse(row.json) as TreeEvent);
  }
  async markSynced(ids: string[]) {
    if (!ids.length) return;
    await this.db.executeSet(
      ids.map((id) => ({ statement: 'UPDATE events SET synced = 1 WHERE id = ?', values: [id] })),
      true,
    );
  }
  async getBlocks() {
    const r = await this.db.query('SELECT json FROM blocks');
    return (r.values ?? []).map((row) => JSON.parse(row.json) as Block);
  }
  async putBlock(block: Block) {
    await this.db.run('INSERT OR REPLACE INTO blocks (id, json) VALUES (?, ?)', [block.id, JSON.stringify(block)]);
  }
  async deleteBlock(id: string) {
    await this.db.run('DELETE FROM blocks WHERE id = ?', [id]);
  }
  async getSetting<T>(key: string) {
    const r = await this.db.query('SELECT json FROM settings WHERE key = ?', [key]);
    const row = r.values?.[0];
    return row ? (JSON.parse(row.json) as T) : undefined;
  }
  async setSetting<T>(key: string, value: T) {
    await this.db.run('INSERT OR REPLACE INTO settings (key, json) VALUES (?, ?)', [key, JSON.stringify(value)]);
  }
  async getRegions() {
    const r = await this.db.query('SELECT json FROM regions');
    return (r.values ?? []).map((row) => JSON.parse(row.json) as TileRegion);
  }
  async putRegion(region: TileRegion) {
    await this.db.run('INSERT OR REPLACE INTO regions (id, json) VALUES (?, ?)', [region.id, JSON.stringify(region)]);
  }
  async deleteRegion(id: string) {
    await Filesystem.rmdir({ path: `tiles/${id}`, directory: Directory.Data, recursive: true }).catch(() => undefined);
    await this.db.run('DELETE FROM tiles WHERE region_id = ?', [id]);
    await this.db.run('DELETE FROM regions WHERE id = ?', [id]);
  }
  async putTile(regionId: string, key: string, data: ArrayBuffer) {
    const path = `tiles/${regionId}/${key.replace(/[^a-zA-Z0-9]/g, '_')}`;
    await Filesystem.writeFile({ path, data: toBase64(data), directory: Directory.Data, recursive: true });
    await this.db.run('INSERT OR REPLACE INTO tiles (key, region_id, path) VALUES (?, ?, ?)', [key, regionId, path]);
  }
  async getTile(key: string) {
    const r = await this.db.query('SELECT path FROM tiles WHERE key = ?', [key]);
    const path = r.values?.[0]?.path as string | undefined;
    if (!path) return undefined;
    try {
      const f = await Filesystem.readFile({ path, directory: Directory.Data });
      return typeof f.data === 'string' ? fromBase64(f.data) : await (f.data as Blob).arrayBuffer();
    } catch {
      return undefined;
    }
  }
}
