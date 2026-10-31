import { describe, expect, it } from 'vitest';
import { IdbStore } from '../src/platform/storage.idb';
import { Repo } from '../src/state/repo';
import { dbName } from './helpers';

const pos = { lat: 50.7, lon: -120.35, accuracyM: 3, fixCount: 5 };

describe('tag allocation', () => {
  it('never reuses voided numbers, also across app restarts', async () => {
    const name = dbName();
    const s1 = new IdbStore(name);
    const r1 = await Repo.open(s1);
    const a = await r1.createTree({ species: 'FD', dbhCm: 40 }, pos);
    const b = await r1.createTree({ species: 'FD', dbhCm: 41 }, pos);
    expect([a.tag, b.tag]).toEqual(['J-0001', 'J-0002']);
    await r1.voidTree(b.id, 'test');
    expect(r1.peekTag(false).tag).toBe('J-0003');
    s1.close();

    // "Restart": a fresh repo over the same database.
    const s2 = new IdbStore(name);
    const r2 = await Repo.open(s2);
    expect(r2.getState().trees.find((t) => t.id === b.id)?.voided).toBe(true);
    const c = await r2.createTree({ species: 'PL', dbhCm: 30 }, pos);
    expect(c.tag).toBe('J-0003');
    expect(r2.settings.deviceId).toBe(r1.settings.deviceId);
    // The hash chain continues from the last event of the previous session.
    const events = r2.getState().events.map((e) => e.event).sort((x, y) => (x.createdAt < y.createdAt ? -1 : 1));
    expect(events.at(-1)!.prevHash).toBe(events.at(-2)!.hash);
    s2.close();
  });

  it('high-water mark protects numbers even if trees disappear from the log', async () => {
    const name = dbName();
    const s1 = new IdbStore(name);
    const r1 = await Repo.open(s1);
    await r1.createTree({ species: 'FD', dbhCm: 40 }, pos);
    await r1.createTree({ species: 'FD', dbhCm: 40 }, pos);
    s1.close();
    // Simulate a lost event log (e.g. restored settings only).
    const s2 = new IdbStore(name);
    await s2.init();
    const settings = await s2.getSetting<any>('settings');
    s2.close();
    const s3 = new IdbStore(dbName());
    await s3.init();
    await s3.setSetting('settings', settings);
    const r3 = await Repo.open(s3);
    expect(r3.peekTag(false).tag).toBe('J-0003');
  });

  it('separate series for leave trees, prefixes and block codes', async () => {
    const r = await Repo.open(new IdbStore(dbName()));
    expect((await r.createTree({ species: 'FD', dbhCm: 60, leaveTree: true }, pos)).tag).toBe('J-L0001');
    expect((await r.createTree({ species: 'FD', dbhCm: 40 }, pos)).tag).toBe('J-0001');
    await r.saveSettings({ blockCode: 'CB12' });
    expect((await r.createTree({ species: 'FD', dbhCm: 40 }, pos)).tag).toBe('CB12-J-0002');
    await r.saveSettings({ tagPrefix: 'K', blockCode: '' });
    expect((await r.createTree({ species: 'FD', dbhCm: 40 }, pos)).tag).toBe('K-0001');
  });

  it('concurrent saves get distinct numbers', async () => {
    const r = await Repo.open(new IdbStore(dbName()));
    const trees = await Promise.all([1, 2, 3, 4, 5].map(() => r.createTree({ species: 'SX', dbhCm: 30 }, pos)));
    expect(new Set(trees.map((t) => t.tag)).size).toBe(5);
  });
});
