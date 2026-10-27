import type { AveragedPosition, Tree, TreeEvent, TreeEventType, TreeFields, TreeStatus } from './types';
import { uuid } from './uuid';

/**
 * JSON with object keys sorted recursively and no whitespace. Undefined values
 * (and functions) are omitted like JSON.stringify does; array order is kept.
 */
export function canonicalJson(obj: unknown): string {
  return JSON.stringify(sortValue(obj));
}

function sortValue(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : sortValue(x)));
  if (typeof (v as { toJSON?: unknown }).toJSON === 'function') return sortValue((v as { toJSON: () => unknown }).toJSON());
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v as Record<string, unknown>).sort()) {
    const x = (v as Record<string, unknown>)[k];
    if (x === undefined || typeof x === 'function') continue;
    out[k] = sortValue(x);
  }
  return out;
}

async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto (crypto.subtle) is not available');
  const buf = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** sha-256 hex of canonicalJson(event without `hash`). A `hash` key, if present, is ignored. */
export async function hashEvent(e: Omit<TreeEvent, 'hash'>): Promise<string> {
  const { hash: _ignored, ...rest } = e as TreeEvent;
  return sha256Hex(canonicalJson(rest));
}

export async function makeEvent(input: {
  treeId: string;
  seq: number;
  type: TreeEventType;
  payload: Record<string, unknown>;
  userId: string;
  deviceId: string;
  prevHash: string;
  createdAt?: string;
  id?: string;
}): Promise<TreeEvent> {
  const base: Omit<TreeEvent, 'hash'> = {
    id: input.id ?? uuid(),
    treeId: input.treeId,
    seq: input.seq,
    type: input.type,
    payload: input.payload,
    userId: input.userId,
    deviceId: input.deviceId,
    createdAt: input.createdAt ?? new Date().toISOString(),
    prevHash: input.prevHash,
  };
  // Round-trip the payload through JSON so the stored hash matches what a server
  // will recompute after the event has been serialised (drops undefined, etc.).
  base.payload = JSON.parse(JSON.stringify(base.payload ?? {}));
  return { ...base, hash: await hashEvent(base) };
}

function byCreatedThenSeq(a: TreeEvent, b: TreeEvent): number {
  if (a.createdAt < b.createdAt) return -1;
  if (a.createdAt > b.createdAt) return 1;
  return a.seq - b.seq;
}

/** Order events that share a timestamp so each follows the one it links to. */
function orderByLinks(group: TreeEvent[], prevHash: string | undefined): TreeEvent[] {
  if (group.length < 2) return group;
  const byPrev = new Map(group.map((e) => [e.prevHash, e]));
  const hashes = new Set(group.map((e) => e.hash));
  const start =
    (prevHash !== undefined ? group.find((e) => e.prevHash === prevHash) : undefined) ??
    group.find((e) => !hashes.has(e.prevHash)) ??
    group[0];
  const out: TreeEvent[] = [];
  const seen = new Set<TreeEvent>();
  for (let cur: TreeEvent | undefined = start; cur && !seen.has(cur); cur = byPrev.get(cur.hash)) {
    out.push(cur);
    seen.add(cur);
  }
  for (const e of group) if (!seen.has(e)) out.push(e);
  return out;
}

/**
 * Verify per-device hash chains. Events are grouped by deviceId and ordered by
 * createdAt then seq (ties with the same createdAt are re-ordered to follow the
 * prevHash links). Each event's hash must recompute, and each prevHash must equal
 * the previous event's hash. The first event of a device's list is not required
 * to have prevHash '' (so a partial slice of a chain can be verified).
 * brokenAt is the id of the first offending event.
 */
export async function verifyChain(events: TreeEvent[]): Promise<{ ok: boolean; brokenAt?: string }> {
  const byDevice = new Map<string, TreeEvent[]>();
  for (const e of events) {
    const list = byDevice.get(e.deviceId);
    if (list) list.push(e);
    else byDevice.set(e.deviceId, [e]);
  }
  for (const list of byDevice.values()) {
    const pre = [...list].sort(byCreatedThenSeq);
    // Resolve same-timestamp ties by following the chain links.
    const sorted: TreeEvent[] = [];
    for (let i = 0; i < pre.length; ) {
      let j = i + 1;
      while (j < pre.length && pre[j].createdAt === pre[i].createdAt) j++;
      sorted.push(...orderByLinks(pre.slice(i, j), sorted[sorted.length - 1]?.hash));
      i = j;
    }
    for (let i = 0; i < sorted.length; i++) {
      const e = sorted[i];
      if (i > 0 && e.prevHash !== sorted[i - 1].hash) return { ok: false, brokenAt: e.id };
      if ((await hashEvent(e)) !== e.hash) return { ok: false, brokenAt: e.id };
    }
  }
  return { ok: true };
}

const FIELD_KEYS: (keyof TreeFields)[] = [
  'species', 'dbhCm', 'heightM', 'heightSource', 'straightness', 'twist', 'branchiness', 'defects', 'leaveTree', 'notes',
];

function applyFields(tree: Tree, fields: unknown) {
  if (!fields || typeof fields !== 'object') return;
  const f = fields as Record<string, unknown>;
  for (const k of FIELD_KEYS) {
    if (!(k in f)) continue;
    const v = f[k];
    if (v === undefined) continue;
    if (v === null) delete (tree as unknown as Record<string, unknown>)[k];
    else (tree as unknown as Record<string, unknown>)[k] = v;
  }
}

function applyPosition(tree: Tree, pos: unknown) {
  if (!pos || typeof pos !== 'object') return;
  const p = pos as Partial<AveragedPosition>;
  if (typeof p.lat === 'number') tree.lat = p.lat;
  if (typeof p.lon === 'number') tree.lon = p.lon;
  if (typeof p.accuracyM === 'number') tree.accuracyM = p.accuracyM;
  if (typeof p.fixCount === 'number') tree.fixCount = p.fixCount;
}

/**
 * Fold the events of one tree into its current state. Events are de-duplicated
 * by id and applied in seq order (createdAt breaks ties). Returns null when
 * there is no create event.
 *
 * - create: { tag, tagNumber, prefix, blockId?, position, fields }
 * - update: { fields } – keys present replace the current value (null clears);
 *   defects are replaced, not appended. Optional { position } moves the tree,
 *   optional { tag, tagNumber, prefix, blockId } re-tags it.
 * - void:   voided = true. { voided: false } in the payload un-voids.
 * - status: { status, stumpDiameterCm? }
 */
export function foldEvents(events: TreeEvent[]): Tree | null {
  const seen = new Set<string>();
  const evs = events
    .filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
    .sort((a, b) => a.seq - b.seq || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  const createIdx = evs.findIndex((e) => e.type === 'create');
  if (createIdx < 0) return null;
  const c = evs[createIdx];
  const p = c.payload as Record<string, unknown>;
  const tree: Tree = {
    id: c.treeId,
    tag: String(p.tag ?? ''),
    tagNumber: Number(p.tagNumber ?? 0),
    prefix: String(p.prefix ?? ''),
    blockId: (p.blockId as string | null | undefined) ?? null,
    lat: NaN,
    lon: NaN,
    accuracyM: NaN,
    fixCount: 0,
    status: 'standing',
    voided: false,
    stumpDiameterCm: null,
    createdBy: c.userId,
    deviceId: c.deviceId,
    createdAt: c.createdAt,
    updatedAt: c.createdAt,
    version: 1,
  };
  applyPosition(tree, p.position);
  applyFields(tree, p.fields);

  let version = 1;
  for (let i = 0; i < evs.length; i++) {
    if (i === createIdx) continue;
    const e = evs[i];
    const pl = (e.payload ?? {}) as Record<string, unknown>;
    switch (e.type) {
      case 'create':
        continue; // duplicate create; ignore
      case 'update':
        applyFields(tree, pl.fields);
        applyPosition(tree, pl.position);
        if (typeof pl.tag === 'string') tree.tag = pl.tag;
        if (typeof pl.tagNumber === 'number') tree.tagNumber = pl.tagNumber;
        if (typeof pl.prefix === 'string') tree.prefix = pl.prefix;
        if ('blockId' in pl) tree.blockId = (pl.blockId as string | null) ?? null;
        break;
      case 'void':
        tree.voided = pl.voided === false ? false : true;
        break;
      case 'status':
        if (typeof pl.status === 'string') tree.status = pl.status as TreeStatus;
        if ('stumpDiameterCm' in pl) tree.stumpDiameterCm = (pl.stumpDiameterCm as number | null) ?? null;
        break;
      default:
        continue;
    }
    version++;
    if (e.createdAt > tree.updatedAt) tree.updatedAt = e.createdAt;
  }
  tree.version = version;
  return tree;
}

/** Fold every tree in a mixed list of events. Trees are returned in createdAt order (then tag). */
export function foldAll(events: TreeEvent[]): Tree[] {
  const byTree = new Map<string, TreeEvent[]>();
  for (const e of events) {
    const list = byTree.get(e.treeId);
    if (list) list.push(e);
    else byTree.set(e.treeId, [e]);
  }
  const trees: Tree[] = [];
  for (const list of byTree.values()) {
    const t = foldEvents(list);
    if (t) trees.push(t);
  }
  return trees.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.tag.localeCompare(b.tag)));
}
