import type { SyncPullResponse, SyncPushResponse, UserProfile } from '@timber/core';
import { Emitter } from '../lib/emitter';
import type { Repo } from '../state/repo';

export interface SyncState {
  status: 'idle' | 'syncing' | 'ok' | 'offline' | 'error' | 'signed-out';
  lastSyncAt: string | null;
  lastError: string | null;
  lastPushed: number;
  lastPulled: number;
}

type FetchLike = typeof fetch;

function joinUrl(base: string, path: string) {
  return base.replace(/\/+$/, '') + path;
}

/**
 * Push events not yet on the server, then pull everything since our cursor.
 * Both directions are idempotent (server dedupes on event id, local store on id),
 * so retrying after a dropped connection is always safe.
 */
export class SyncClient extends Emitter<SyncState> {
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private repo: Repo,
    private fetchImpl: FetchLike = (...a) => fetch(...a),
    private isOnline: () => boolean = () => globalThis.navigator?.onLine !== false,
  ) {
    super({ status: 'idle', lastSyncAt: null, lastError: null, lastPushed: 0, lastPulled: 0 });
  }

  async signIn(serverUrl: string, email: string, password: string): Promise<UserProfile> {
    const res = await this.fetchImpl(joinUrl(serverUrl, '/api/auth/token'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, deviceId: this.repo.settings.deviceId, deviceName: 'iPhone' }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.token) throw new Error(body.error || `Sign in failed (${res.status})`);
    const user: UserProfile = body.user ?? { id: body.userId, email, name: email, tagPrefix: this.repo.prefix };
    await this.repo.saveSettings({
      serverUrl,
      token: body.token,
      user,
      lastUserId: user.id,
      userName: user.name || this.repo.settings.userName,
      tagPrefix: user.tagPrefix || this.repo.settings.tagPrefix,
    });
    await this.repo.adoptUser(user.id);
    this.setState({ status: 'idle', lastError: null });
    return user;
  }

  async signOut() {
    await this.repo.saveSettings({ token: null, user: null });
    this.setState({ status: 'signed-out' });
  }

  private headers() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.repo.settings.token}`,
    };
  }

  /** One full sync. Concurrent calls share the in-flight run. */
  sync(): Promise<void> {
    if (!this.running) this.running = this.run().finally(() => (this.running = null));
    return this.running;
  }

  private async run() {
    const { token, serverUrl, deviceId } = this.repo.settings;
    if (!token) {
      this.setState({ status: 'signed-out' });
      return;
    }
    if (!this.isOnline()) {
      this.setState({ status: 'offline' });
      return;
    }
    this.setState({ status: 'syncing', lastError: null });
    try {
      // Push.
      const unsynced = (await this.repo.store.unsyncedEvents()).sort((a, b) =>
        a.createdAt === b.createdAt ? a.seq - b.seq : a.createdAt < b.createdAt ? -1 : 1,
      );
      let pushed = 0;
      for (let i = 0; i < unsynced.length; i += 200) {
        const batch = unsynced.slice(i, i + 200);
        const res = await this.fetchImpl(joinUrl(serverUrl, '/api/sync/push'), {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({ deviceId, events: batch, blocks: this.repo.getState().blocks }),
        });
        if (res.status === 401) throw new Error('Signed out: sign in again');
        if (!res.ok) throw new Error(`push failed (${res.status})`);
        const body = (await res.json()) as SyncPushResponse;
        await this.repo.markSynced(body.accepted ?? []);
        pushed += body.accepted?.length ?? 0;
        if (body.rejected?.length) {
          this.setState({ lastError: `${body.rejected.length} rejected: ${body.rejected[0].reason}` });
        }
      }
      // Pull (loop while the server keeps returning pages).
      let cursor = (await this.repo.store.getSetting<string>('syncCursor')) ?? '';
      let pulled = 0;
      for (let page = 0; page < 50; page++) {
        const res = await this.fetchImpl(
          joinUrl(serverUrl, `/api/sync/pull?since=${encodeURIComponent(cursor)}`),
          { headers: this.headers() },
        );
        if (res.status === 401) throw new Error('Signed out: sign in again');
        if (!res.ok) throw new Error(`pull failed (${res.status})`);
        const body = (await res.json()) as SyncPullResponse;
        await this.repo.ingest(body.events ?? []);
        for (const b of body.blocks ?? []) await this.repo.putBlock(b);
        if (body.scenarios?.length) {
          const latest = [...body.scenarios].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
          await this.repo.saveSettings({ scenario: latest });
        }
        pulled += body.events?.length ?? 0;
        const next = body.cursor ?? cursor;
        await this.repo.store.setSetting('syncCursor', next);
        if (!body.events?.length || next === cursor) break;
        cursor = next;
      }
      this.setState({
        status: 'ok',
        lastSyncAt: new Date().toISOString(),
        lastPushed: pushed,
        lastPulled: pulled,
        lastError: this.state.lastError,
      });
    } catch (err) {
      const msg = (err as Error).message || String(err);
      const offline = /fetch|network|load failed/i.test(msg);
      this.setState({ status: offline ? 'offline' : 'error', lastError: msg });
    }
  }

  /** Auto-sync every 60 s and whenever the connection comes back. */
  startAuto(intervalMs = 60_000) {
    this.stopAuto();
    const tick = () => {
      if (this.repo.settings.autoSync && this.repo.settings.token) void this.sync();
    };
    this.timer = setInterval(tick, intervalMs);
    globalThis.addEventListener?.('online', tick);
    this.onlineHandler = tick;
    tick();
  }
  private onlineHandler: (() => void) | null = null;
  stopAuto() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.onlineHandler) globalThis.removeEventListener?.('online', this.onlineHandler);
  }
}
