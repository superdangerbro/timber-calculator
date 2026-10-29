import {
  DEFAULT_SCENARIO,
  foldAll,
  formatTag,
  makeEvent,
  nextTagNumber,
  uuid,
  type AveragedPosition,
  type Block,
  type Scenario,
  type Tree,
  type TreeEvent,
  type TreeEventType,
  type TreeFields,
  type TreePhoto,
  type TreeStatus,
} from '@timber/core';
import { blobBytes, sha256Hex } from '../lib/photo';
import { Emitter } from '../lib/emitter';
import type { LocalStore, StoredEvent } from '../platform/types';
import { defaultSettings, type Settings } from './settings';

export interface RepoState {
  ready: boolean;
  events: StoredEvent[];
  trees: Tree[];
  blocks: Block[];
  settings: Settings;
  unsyncedCount: number;
  /** Trees on this device whose tag is also held by an earlier tree elsewhere. */
  clashes: TagClash[];
  /** Bumped when photo bytes are added locally (so thumbnails refresh). */
  photoVersion: number;
}

export interface TagClash {
  tree: Tree;
  /** The tree that keeps the tag (earliest created, then lowest id). */
  holder: Tree;
}

/**
 * Two live trees with the same tag (tallied before first sign-in, or on two
 * offline devices sharing a prefix). The earliest-created tree keeps the tag;
 * every other one created on `deviceId` must be re-tagged. Every device applies
 * the same rule, so they agree on who keeps it without talking to each other.
 */
export function findClashes(trees: Tree[], deviceId: string): TagClash[] {
  const byTag = new Map<string, Tree[]>();
  for (const t of trees) {
    if (t.voided || !t.tag) continue;
    const list = byTag.get(t.tag);
    if (list) list.push(t);
    else byTag.set(t.tag, [t]);
  }
  const out: TagClash[] = [];
  for (const list of byTag.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) =>
      a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1,
    );
    const holder = sorted[0];
    for (const t of sorted.slice(1)) if (t.deviceId === deviceId) out.push({ tree: t, holder });
  }
  return out.sort((a, b) => (a.tree.createdAt < b.tree.createdAt ? -1 : 1));
}

/** "J-L0003" is the leave-tree series; everything else is the main series. */
export function tagSeries(tag: string): 'L' | 'N' {
  return /-L\d+$/.test(tag) ? 'L' : 'N';
}

export function isToday(iso: string, now = new Date()): boolean {
  const d = new Date(iso);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

/**
 * Local data layer: an append-only, hash-chained event log persisted through
 * LocalStore, folded into trees in memory. All writes go through one queue so
 * tag numbers and the per-device hash chain stay consistent.
 */
export class Repo extends Emitter<RepoState> {
  private queue: Promise<unknown> = Promise.resolve();
  private chainHead = '';
  private lastCreatedMs = 0;

  constructor(
    readonly store: LocalStore,
    private now: () => Date = () => new Date(),
  ) {
    super({
      ready: false,
      events: [],
      trees: [],
      blocks: [],
      settings: defaultSettings(''),
      unsyncedCount: 0,
      clashes: [],
      photoVersion: 0,
    });
  }

  static async open(store: LocalStore, now?: () => Date): Promise<Repo> {
    const r = new Repo(store, now);
    await r.load();
    return r;
  }

  async load() {
    await this.store.init();
    let deviceId = await this.store.getSetting<string>('deviceId');
    if (!deviceId) {
      deviceId = uuid();
      await this.store.setSetting('deviceId', deviceId);
    }
    const saved = (await this.store.getSetting<Partial<Settings>>('settings')) ?? {};
    const settings: Settings = { ...defaultSettings(deviceId), ...saved, deviceId };
    const events = await this.store.allEvents();
    const blocks = await this.store.getBlocks();
    this.recomputeChain(events.map((e) => e.event), deviceId);
    this.state = { ...this.state, ready: true, settings, blocks };
    this.setEvents(events);
  }

  private recomputeChain(events: TreeEvent[], deviceId: string) {
    const mine = events
      .filter((e) => e.deviceId === deviceId)
      .sort((a, b) => (a.createdAt === b.createdAt ? a.seq - b.seq : a.createdAt < b.createdAt ? -1 : 1));
    const last = mine[mine.length - 1];
    this.chainHead = last?.hash ?? '';
    this.lastCreatedMs = last ? Date.parse(last.createdAt) : 0;
  }

  private setEvents(events: StoredEvent[]) {
    const trees = foldAll(events.map((e) => e.event));
    trees.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    this.setState({
      events,
      trees,
      unsyncedCount: events.filter((e) => !e.synced).length,
      clashes: findClashes(trees, this.state.settings.deviceId),
    });
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn, fn);
    this.queue = p.catch(() => undefined);
    return p;
  }

  get settings() {
    return this.state.settings;
  }
  get scenario(): Scenario {
    return this.state.settings.scenario ?? DEFAULT_SCENARIO;
  }
  get userId() {
    const st = this.state.settings;
    return st.user?.id ?? st.lastUserId ?? `local-${st.deviceId}`;
  }
  get prefix() {
    return (this.state.settings.user?.tagPrefix || this.state.settings.tagPrefix || 'J').toUpperCase();
  }
  tree(id: string) {
    return this.state.trees.find((t) => t.id === id);
  }

  saveSettings(patch: Partial<Settings>) {
    return this.enqueue(async () => {
      const settings = { ...this.state.settings, ...patch };
      await this.store.setSetting('settings', settings);
      this.setState({ settings });
    });
  }

  /** Next tag for this user's prefix; voided numbers are never reused. */
  peekTag(leave: boolean): { tag: string; tagNumber: number } {
    const prefix = this.prefix;
    const series = leave ? 'L' : 'N';
    const used = this.state.trees
      .filter((t) => (t.prefix || '').toUpperCase() === prefix && tagSeries(t.tag) === series)
      .map((t) => t.tagNumber);
    const hw = this.state.settings.tagHighWater[`${prefix}:${series}`] ?? 0;
    const n = Math.max(nextTagNumber(used), hw + 1);
    const blockCode = this.state.settings.blockCode.trim().toUpperCase() || undefined;
    return { tag: formatTag(prefix, n, { blockCode, leave }), tagNumber: n };
  }

  private async append(treeId: string, type: TreeEventType, payload: Record<string, unknown>): Promise<TreeEvent> {
    const seq = this.state.events.filter((e) => e.event.treeId === treeId).length + 1;
    // createdAt strictly increases per device so chain order is unambiguous.
    let ms = this.now().getTime();
    if (ms <= this.lastCreatedMs) ms = this.lastCreatedMs + 1;
    const event = await makeEvent({
      treeId,
      seq,
      type,
      payload,
      userId: this.userId,
      deviceId: this.state.settings.deviceId,
      prevHash: this.chainHead,
      createdAt: new Date(ms).toISOString(),
    });
    await this.store.putEvents([event], false);
    this.chainHead = event.hash;
    this.lastCreatedMs = ms;
    this.setEvents([...this.state.events, { event, synced: false }]);
    return event;
  }

  createTree(fields: TreeFields, position: AveragedPosition | null): Promise<Tree> {
    return this.enqueue(async () => {
      const leave = !!fields.leaveTree;
      const { tag, tagNumber } = this.peekTag(leave);
      const prefix = this.prefix;
      const series = leave ? 'L' : 'N';
      // Persist the high-water mark first: even if the event write fails the number is burnt.
      const tagHighWater = { ...this.state.settings.tagHighWater, [`${prefix}:${series}`]: tagNumber };
      const settings = { ...this.state.settings, tagHighWater };
      await this.store.setSetting('settings', settings);
      this.state = { ...this.state, settings };
      const treeId = uuid();
      await this.append(treeId, 'create', {
        tag,
        tagNumber,
        prefix,
        blockId: this.state.settings.activeBlockId ?? null,
        position: position ?? { lat: 0, lon: 0, accuracyM: 0, fixCount: 0 },
        fields,
      });
      return this.tree(treeId)!;
    });
  }

  /**
   * Give a clashing tree the next free number in its series (main or leave) under
   * the current prefix. The old number stays burnt; the re-tag is an `update`
   * event, so the history shows both tags.
   */
  retag(treeId: string): Promise<Tree> {
    return this.enqueue(async () => {
      const tree = this.tree(treeId);
      if (!tree) throw new Error('No such tree');
      const leave = tagSeries(tree.tag) === 'L';
      const { tag, tagNumber } = this.peekTag(leave);
      const prefix = this.prefix;
      const tagHighWater = { ...this.state.settings.tagHighWater, [`${prefix}:${leave ? 'L' : 'N'}`]: tagNumber };
      const settings = { ...this.state.settings, tagHighWater };
      await this.store.setSetting('settings', settings);
      this.state = { ...this.state, settings };
      await this.append(treeId, 'update', { tag, tagNumber, prefix, fields: {}, retaggedFrom: tree.tag });
      return this.tree(treeId)!;
    });
  }

  /**
   * Attach a photo (already compressed) to a tree: the bytes go to local storage,
   * and an append-only `update` event records its id, size, place and sha-256.
   */
  addPhoto(
    treeId: string,
    photo: { blob: Blob; width: number; height: number; lat?: number | null; lon?: number | null },
  ): Promise<TreePhoto> {
    return this.enqueue(async () => {
      const data = await blobBytes(photo.blob);
      const meta: TreePhoto = {
        id: uuid(),
        takenAt: this.now().toISOString(),
        lat: photo.lat ?? null,
        lon: photo.lon ?? null,
        width: photo.width,
        height: photo.height,
        bytes: data.byteLength,
        sha256: await sha256Hex(data),
      };
      await this.store.putPhoto({ id: meta.id, treeId, type: photo.blob.type || 'image/jpeg', data, sha256: meta.sha256, synced: false });
      await this.append(treeId, 'update', { photos: [meta] });
      this.setState({ photoVersion: this.state.photoVersion + 1 });
      return meta;
    });
  }

  updateTree(treeId: string, fields: TreeFields) {
    return this.enqueue(() => this.append(treeId, 'update', { fields }));
  }
  voidTree(treeId: string, reason?: string) {
    return this.enqueue(() => this.append(treeId, 'void', reason ? { reason } : {}));
  }
  setStatus(treeId: string, status: TreeStatus, stumpDiameterCm?: number | null) {
    return this.enqueue(() =>
      this.append(treeId, 'status', stumpDiameterCm != null ? { status, stumpDiameterCm } : { status }),
    );
  }

  /**
   * After signing in: events tallied before the first sign-in carry a placeholder
   * "local-<device>" user id, which the server rejects. They have never left the
   * phone, so re-sign them (same ids, times, payloads) for the account and
   * re-link this device's hash chain from the first rewritten event onward.
   */
  adoptUser(userId: string) {
    return this.enqueue(async () => {
      const deviceId = this.state.settings.deviceId;
      const stored = await this.store.allEvents();
      const synced = new Set(stored.filter((s) => s.synced).map((s) => s.event.id));
      const mine = stored
        .map((s) => s.event)
        .filter((e) => e.deviceId === deviceId)
        .sort((a, b) => (a.createdAt === b.createdAt ? a.seq - b.seq : a.createdAt < b.createdAt ? -1 : 1));
      const first = mine.findIndex((e) => e.userId.startsWith('local-') && !synced.has(e.id));
      if (first < 0) return;
      const rewritten: TreeEvent[] = [];
      let prev = first > 0 ? mine[first - 1].hash : '';
      for (const e of mine.slice(first)) {
        if (synced.has(e.id)) break; // cannot happen in practice: local events are never pushed
        const next = await makeEvent({
          id: e.id,
          treeId: e.treeId,
          seq: e.seq,
          type: e.type,
          payload: e.payload,
          userId: e.userId.startsWith('local-') ? userId : e.userId,
          deviceId: e.deviceId,
          prevHash: prev,
          createdAt: e.createdAt,
        });
        rewritten.push(next);
        prev = next.hash;
      }
      await this.store.replaceEvents(rewritten);
      this.chainHead = prev;
      this.setEvents(await this.store.allEvents());
    });
  }

  /** Events pulled from the server (already synced). Idempotent. */
  ingest(events: TreeEvent[]) {
    return this.enqueue(async () => {
      if (!events.length) return;
      await this.store.putEvents(events, true);
      this.setEvents(await this.store.allEvents());
    });
  }
  markSynced(ids: string[]) {
    return this.enqueue(async () => {
      await this.store.markSynced(ids);
      const set = new Set(ids);
      this.setEvents(this.state.events.map((e) => (set.has(e.event.id) ? { ...e, synced: true } : e)));
    });
  }
  putBlock(block: Block) {
    return this.enqueue(async () => {
      await this.store.putBlock(block);
      this.setState({ blocks: [...this.state.blocks.filter((b) => b.id !== block.id), block] });
    });
  }
  deleteBlock(id: string) {
    return this.enqueue(async () => {
      await this.store.deleteBlock(id);
      this.setState({ blocks: this.state.blocks.filter((b) => b.id !== id) });
    });
  }

  /** Most recent non-voided tree tallied on this device (target of "undo"). */
  lastOwnTree(): Tree | undefined {
    return this.state.trees.find((t) => !t.voided && t.deviceId === this.state.settings.deviceId);
  }
}
