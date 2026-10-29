import { customType } from 'drizzle-orm/pg-core';
import type { TreePhoto } from '@timber/core';
import {
  pgTable, uuid, text, timestamp, integer, bigserial, jsonb, doublePrecision, boolean, index, uniqueIndex,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  tagPrefix: text('tag_prefix').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('users_email_idx').on(t.email),
  uniqueIndex('users_tag_prefix_idx').on(t.tagPrefix),
]);

export const devices = pgTable('devices', {
  id: text('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name'),
  lastSeen: timestamp('last_seen', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('devices_user_idx').on(t.userId)]);

/** Append-only hash-chained events. `created_at` is kept as the exact ISO text that was hashed. */
export const events = pgTable('events', {
  id: uuid('id').primaryKey(),
  serverSeq: bigserial('server_seq', { mode: 'number' }).notNull().unique(),
  treeId: uuid('tree_id').notNull(),
  seq: integer('seq').notNull(),
  type: text('type').notNull(),
  payload: jsonb('payload').notNull().$type<Record<string, unknown>>(),
  userId: text('user_id').notNull(),
  deviceId: text('device_id').notNull(),
  createdAt: text('created_at').notNull(),
  prevHash: text('prev_hash').notNull(),
  hash: text('hash').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('events_tree_idx').on(t.treeId),
  index('events_device_idx').on(t.deviceId),
  index('events_hash_idx').on(t.hash),
]);

/** Materialized current state of each tree, refreshed from events with foldEvents. */
export const trees = pgTable('trees', {
  id: uuid('id').primaryKey(),
  tag: text('tag').notNull(),
  tagNumber: integer('tag_number').notNull(),
  prefix: text('prefix').notNull(),
  blockId: text('block_id'),
  lat: doublePrecision('lat').notNull(),
  lon: doublePrecision('lon').notNull(),
  accuracyM: doublePrecision('accuracy_m').notNull().default(0),
  fixCount: integer('fix_count').notNull().default(0),
  /** 'adjusted' when the pin was moved by hand; the raw averaged fix is kept in gps_*. */
  positionSource: text('position_source'),
  gpsLat: doublePrecision('gps_lat'),
  gpsLon: doublePrecision('gps_lon'),
  gpsAccuracyM: doublePrecision('gps_accuracy_m'),
  status: text('status').notNull().default('standing'),
  voided: boolean('voided').notNull().default(false),
  species: text('species'),
  dbhCm: doublePrecision('dbh_cm'),
  circumferenceCm: doublePrecision('circumference_cm'),
  heightM: doublePrecision('height_m'),
  heightSource: text('height_source'),
  straightness: integer('straightness'),
  twist: integer('twist'),
  branchiness: integer('branchiness'),
  defects: text('defects'),
  leaveTree: boolean('leave_tree'),
  notes: text('notes'),
  stumpDiameterCm: doublePrecision('stump_diameter_cm'),
  photos: jsonb('photos').$type<TreePhoto[]>(),
  createdBy: text('created_by').notNull(),
  deviceId: text('device_id').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  version: integer('version').notNull().default(1),
}, (t) => [index('trees_block_idx').on(t.blockId), index('trees_prefix_idx').on(t.prefix)]);

export const blocks = pgTable('blocks', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  code: text('code'),
  boundary: jsonb('boundary').notNull().$type<GeoJSON.Polygon | GeoJSON.MultiPolygon>(),
  createdBy: text('created_by').notNull(),
  createdAt: text('created_at').notNull(),
});

export const scenarios = pgTable('scenarios', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  data: jsonb('data').notNull().$type<Record<string, unknown>>(),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: text('updated_at').notNull(),
});

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

/**
 * Tree photo bytes, keyed by the photo id recorded in a tree event. Kept in Postgres
 * for now; swap for Vercel Blob or S3 in production (only this table and the
 * /api/photos route change).
 */
export const photos = pgTable('photos', {
  id: uuid('id').primaryKey(),
  treeId: uuid('tree_id'),
  sha256: text('sha256').notNull(),
  contentType: text('content_type').notNull().default('image/jpeg'),
  bytes: integer('bytes').notNull(),
  data: bytea('data').notNull(),
  uploadedBy: text('uploaded_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('photos_tree_idx').on(t.treeId)]);
