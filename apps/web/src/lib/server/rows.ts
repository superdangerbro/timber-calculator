import { normalizeScenario } from '@timber/core';
import type { Block, Scenario, Tree, TreeEvent, TreeStatus, Scale, SpeciesCode } from '@timber/core';
import type { schema } from '@/db';

type EventRow = typeof schema.events.$inferSelect;
type TreeRow = typeof schema.trees.$inferSelect;
type BlockRow = typeof schema.blocks.$inferSelect;
type ScenarioRow = typeof schema.scenarios.$inferSelect;

export function rowToEvent(r: EventRow): TreeEvent {
  return {
    id: r.id, treeId: r.treeId, seq: r.seq, type: r.type as TreeEvent['type'], payload: r.payload,
    userId: r.userId, deviceId: r.deviceId, createdAt: r.createdAt, prevHash: r.prevHash, hash: r.hash,
  };
}

export function eventToRow(e: TreeEvent): typeof schema.events.$inferInsert {
  return {
    id: e.id, treeId: e.treeId, seq: e.seq, type: e.type, payload: e.payload, userId: e.userId,
    deviceId: e.deviceId, createdAt: e.createdAt, prevHash: e.prevHash, hash: e.hash,
  };
}

const nn = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);

export function rowToTree(r: TreeRow): Tree {
  return {
    id: r.id, tag: r.tag, tagNumber: r.tagNumber, prefix: r.prefix, blockId: r.blockId,
    lat: r.lat, lon: r.lon, accuracyM: r.accuracyM, fixCount: r.fixCount,
    status: r.status as TreeStatus, voided: r.voided,
    species: nn(r.species) as SpeciesCode | undefined, dbhCm: nn(r.dbhCm),
    circumferenceCm: nn(r.circumferenceCm), photos: nn(r.photos) ?? undefined, heightM: nn(r.heightM),
    heightSource: nn(r.heightSource) as Tree['heightSource'],
    straightness: nn(r.straightness) as Scale | undefined, twist: nn(r.twist) as Scale | undefined,
    branchiness: nn(r.branchiness) as Scale | undefined, defects: nn(r.defects), leaveTree: nn(r.leaveTree),
    notes: nn(r.notes), stumpDiameterCm: r.stumpDiameterCm, createdBy: r.createdBy, deviceId: r.deviceId,
    createdAt: r.createdAt, updatedAt: r.updatedAt, version: r.version,
  };
}

export function treeToRow(t: Tree): typeof schema.trees.$inferInsert {
  return {
    id: t.id, tag: t.tag, tagNumber: t.tagNumber, prefix: t.prefix, blockId: t.blockId ?? null,
    lat: t.lat, lon: t.lon, accuracyM: t.accuracyM ?? 0, fixCount: t.fixCount ?? 0,
    status: t.status ?? 'standing', voided: !!t.voided,
    species: t.species ?? null, dbhCm: t.dbhCm ?? null,
    circumferenceCm: t.circumferenceCm ?? null, photos: t.photos?.length ? t.photos : null, heightM: t.heightM ?? null, heightSource: t.heightSource ?? null,
    straightness: t.straightness ?? null, twist: t.twist ?? null, branchiness: t.branchiness ?? null,
    defects: t.defects ?? null, leaveTree: t.leaveTree ?? null, notes: t.notes ?? null,
    stumpDiameterCm: t.stumpDiameterCm ?? null, createdBy: t.createdBy, deviceId: t.deviceId,
    createdAt: t.createdAt, updatedAt: t.updatedAt, version: t.version ?? 1,
  };
}

export function rowToBlock(r: BlockRow): Block {
  return { id: r.id, name: r.name, code: r.code ?? undefined, boundary: r.boundary, createdBy: r.createdBy, createdAt: r.createdAt };
}

export function rowToScenario(r: ScenarioRow): Scenario & { createdBy: string } {
  return { ...normalizeScenario(r.data as Record<string, unknown>), id: r.id, name: r.name, updatedAt: r.updatedAt, createdBy: r.createdBy };
}
