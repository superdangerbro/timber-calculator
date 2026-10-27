import { describe, expect, it } from 'vitest';
import { makeEvent, uuid } from '@timber/core';
import { IdbStore } from '../src/platform/storage.idb';
import { Repo } from '../src/state/repo';
import { dbName, makeRig } from './helpers';

const pos = { lat: 50.7, lon: -120.35, accuracyM: 3, fixCount: 5 };

/** A create event from another device, as a sync pull would deliver it. */
async function foreignCreate(tag: string, tagNumber: number, createdAt: string) {
  return makeEvent({
    treeId: uuid(),
    seq: 1,
    type: 'create',
    payload: { tag, tagNumber, prefix: 'J', position: pos, fields: { species: 'FD', dbhCm: 40 } },
    userId: 'u-joe',
    deviceId: 'other-device',
    prevHash: '',
    createdAt,
  });
}

describe('tag clashes', () => {
  it('flags our later tree when a pulled tree already holds the tag, and re-tags it', async () => {
    const repo = await Repo.open(new IdbStore(dbName()));
    const mine = await repo.createTree({ species: 'PL', dbhCm: 30 }, pos);
    expect(mine.tag).toBe('J-0001');
    expect(repo.getState().clashes).toEqual([]);

    // Server already had J-0001 .. J-0074 from an earlier cruise.
    const pulled = [];
    for (let n = 1; n <= 74; n++) pulled.push(await foreignCreate(`J-${String(n).padStart(4, '0')}`, n, `2026-10-05T15:${String(n % 60).padStart(2, '0')}:00.000Z`));
    await repo.ingest(pulled);

    const clashes = repo.getState().clashes;
    expect(clashes).toHaveLength(1);
    expect(clashes[0].tree.id).toBe(mine.id);
    expect(clashes[0].holder.deviceId).toBe('other-device');

    const retagged = await repo.retag(mine.id);
    expect(retagged.tag).toBe('J-0075');
    expect(repo.getState().clashes).toEqual([]);
    // The re-tag is an update event, so history keeps the old tag.
    const evs = repo.getState().events.filter((e) => e.event.treeId === mine.id).map((e) => e.event);
    expect(evs.map((e) => e.type)).toEqual(['create', 'update']);
    expect(evs[1].payload).toMatchObject({ tag: 'J-0075', retaggedFrom: 'J-0001' });
    // Next fresh tree continues after the re-tag.
    expect(repo.peekTag(false).tag).toBe('J-0076');
  });

  it('keeps the tag when our tree is the earlier holder', async () => {
    const repo = await Repo.open(new IdbStore(dbName()));
    const mine = await repo.createTree({ species: 'PL', dbhCm: 30 }, pos);
    await repo.ingest([await foreignCreate('J-0001', 1, '2099-01-01T00:00:00.000Z')]);
    expect(mine.tag).toBe('J-0001');
    expect(repo.getState().clashes).toEqual([]);
  });

  it('ignores voided trees', async () => {
    const repo = await Repo.open(new IdbStore(dbName()));
    const mine = await repo.createTree({ species: 'PL', dbhCm: 30 }, pos);
    await repo.voidTree(mine.id);
    await repo.ingest([await foreignCreate('J-0001', 1, '2020-01-01T00:00:00.000Z')]);
    expect(repo.getState().clashes).toEqual([]);
  });

  it('re-tags leave trees within the leave series', async () => {
    const repo = await Repo.open(new IdbStore(dbName()));
    const leave = await repo.createTree({ species: 'FD', dbhCm: 70, leaveTree: true }, pos);
    expect(leave.tag).toBe('J-L0001');
    await repo.ingest([await foreignCreate('J-L0001', 1, '2020-01-01T00:00:00.000Z')]);
    expect(repo.getState().clashes).toHaveLength(1);
    expect((await repo.retag(leave.id)).tag).toBe('J-L0002');
  });

  it('tally.retag shows and speaks the new tag', async () => {
    const rig = await makeRig();
    const mine = await rig.repo.createTree({ species: 'PL', dbhCm: 30 }, pos);
    await rig.repo.ingest([await foreignCreate('J-0001', 1, '2020-01-01T00:00:00.000Z')]);
    await rig.tally.retag(mine.id);
    const st = rig.tally.getState();
    expect(st.lastTag).toBe('J-0002');
    expect(st.phase).toBe('saved');
    expect(st.spoken).toMatch(/zero zero zero two/);
  });
});
