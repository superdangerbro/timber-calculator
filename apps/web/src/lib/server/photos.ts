import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { photos } from '@/db/schema';
import { HttpError } from './sync';

export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sha256Hex(buf: Uint8Array): string {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Store a photo's bytes. Idempotent: re-sending the same bytes for the same id is a
 * no-op; different bytes under an existing id are refused (photos are evidence).
 * The sha256 the phone recorded in the tree event must match the bytes.
 */
export async function putPhoto(
  db: DB,
  input: { id: string; data: Uint8Array; contentType: string; sha256: string; treeId?: string | null; userId: string },
): Promise<{ id: string; sha256: string; bytes: number; existed: boolean }> {
  if (!UUID.test(input.id)) throw new HttpError(400, 'Photo id must be a uuid');
  const type = input.contentType.split(';')[0].trim().toLowerCase();
  if (!TYPES.has(type)) throw new HttpError(415, 'Photo must be JPEG, PNG or WebP');
  if (!input.data.byteLength) throw new HttpError(400, 'Empty photo');
  if (input.data.byteLength > MAX_PHOTO_BYTES) throw new HttpError(413, 'Photo is too large');
  const actual = sha256Hex(input.data);
  if (!input.sha256 || actual !== input.sha256.toLowerCase()) throw new HttpError(400, 'sha256 does not match the photo bytes');
  if (input.treeId && !UUID.test(input.treeId)) throw new HttpError(400, 'Tree id must be a uuid');

  const [existing] = await db.select({ sha256: photos.sha256, bytes: photos.bytes }).from(photos).where(eq(photos.id, input.id));
  if (existing) {
    if (existing.sha256 !== actual) throw new HttpError(409, 'A different photo is already stored under this id');
    return { id: input.id, sha256: actual, bytes: existing.bytes, existed: true };
  }
  await db
    .insert(photos)
    .values({
      id: input.id, treeId: input.treeId ?? null, sha256: actual, contentType: type,
      bytes: input.data.byteLength, data: Buffer.from(input.data), uploadedBy: input.userId,
    })
    .onConflictDoNothing();
  return { id: input.id, sha256: actual, bytes: input.data.byteLength, existed: false };
}

export async function getPhoto(db: DB, id: string) {
  if (!UUID.test(id)) throw new HttpError(404, 'Photo not found');
  const [row] = await db.select().from(photos).where(eq(photos.id, id));
  if (!row) throw new HttpError(404, 'Photo not found');
  return row;
}
