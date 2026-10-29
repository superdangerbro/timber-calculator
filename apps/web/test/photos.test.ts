import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql as dsql } from 'drizzle-orm';
import { uuid } from '@timber/core';
import '../scripts/env';
import { runMigrations } from '../scripts/migrate';
import { createDb, type DB } from '../src/db';
import { getPhoto, putPhoto, sha256Hex } from '../src/lib/server/photos';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://timber:timber@localhost:5432/timber_test';
let db: DB; let close: () => Promise<void>;

beforeAll(async () => {
  await runMigrations(url);
  const c = createDb(url); db = c.db; close = () => c.sql.end();
});
afterAll(async () => { await close(); });
beforeEach(async () => { await db.execute(dsql`truncate table photos`); });

const jpeg = (seed: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, seed, 1, 2, 3, 4, 5, 0xff, 0xd9]);

describe('photo upload', () => {
  it('stores bytes and serves them back', async () => {
    const id = uuid(); const data = jpeg(1);
    const r = await putPhoto(db, { id, data, contentType: 'image/jpeg', sha256: sha256Hex(data), treeId: uuid(), userId: 'u1' });
    expect(r.existed).toBe(false);
    const row = await getPhoto(db, id);
    expect(new Uint8Array(row.data)).toEqual(data);
    expect(row.sha256).toBe(sha256Hex(data));
  });
  it('is idempotent for the same bytes', async () => {
    const id = uuid(); const data = jpeg(2);
    await putPhoto(db, { id, data, contentType: 'image/jpeg', sha256: sha256Hex(data), userId: 'u1' });
    const again = await putPhoto(db, { id, data, contentType: 'image/jpeg', sha256: sha256Hex(data), userId: 'u1' });
    expect(again.existed).toBe(true);
  });
  it('rejects a sha256 that does not match the bytes', async () => {
    const data = jpeg(3);
    await expect(putPhoto(db, { id: uuid(), data, contentType: 'image/jpeg', sha256: sha256Hex(jpeg(4)), userId: 'u1' }))
      .rejects.toMatchObject({ status: 400 });
  });
  it('refuses different bytes under an existing id', async () => {
    const id = uuid(); const a = jpeg(5); const b = jpeg(6);
    await putPhoto(db, { id, data: a, contentType: 'image/jpeg', sha256: sha256Hex(a), userId: 'u1' });
    await expect(putPhoto(db, { id, data: b, contentType: 'image/jpeg', sha256: sha256Hex(b), userId: 'u1' }))
      .rejects.toMatchObject({ status: 409 });
  });
  it('rejects non-images, empty bodies and bad ids', async () => {
    const d = jpeg(7);
    await expect(putPhoto(db, { id: uuid(), data: d, contentType: 'text/plain', sha256: sha256Hex(d), userId: 'u1' })).rejects.toMatchObject({ status: 415 });
    await expect(putPhoto(db, { id: uuid(), data: new Uint8Array(), contentType: 'image/jpeg', sha256: '', userId: 'u1' })).rejects.toMatchObject({ status: 400 });
    await expect(putPhoto(db, { id: 'nope', data: d, contentType: 'image/jpeg', sha256: sha256Hex(d), userId: 'u1' })).rejects.toMatchObject({ status: 400 });
  });
});
