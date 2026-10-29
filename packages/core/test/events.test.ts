import { describe, expect, it } from 'vitest';
import { canonicalJson, foldAll, foldEvents, hashEvent, makeEvent, uuid, verifyChain } from '../src';
import type { TreeEvent } from '../src';

async function chain(deviceId = 'dev1', treeId = 'tree-1') {
  const t0 = Date.parse('2026-10-01T17:00:00.000Z');
  const at = (s: number) => new Date(t0 + s * 1000).toISOString();
  const e1 = await makeEvent({
    treeId,
    seq: 1,
    type: 'create',
    payload: {
      tag: 'J-0001',
      tagNumber: 1,
      prefix: 'J',
      blockId: 'b1',
      position: { lat: 50.7, lon: -120.35, accuracyM: 3, fixCount: 5 },
      fields: { species: 'FD', dbhCm: 42, heightM: 30, straightness: 4, twist: 5, branchiness: 3 },
    },
    userId: 'u1',
    deviceId,
    prevHash: '',
    createdAt: at(0),
  });
  const e2 = await makeEvent({ treeId, seq: 2, type: 'update', payload: { fields: { dbhCm: 44, defects: 'sweep' } }, userId: 'u1', deviceId, prevHash: e1.hash, createdAt: at(10) });
  const e3 = await makeEvent({ treeId, seq: 3, type: 'void', payload: { reason: 'duplicate' }, userId: 'u1', deviceId, prevHash: e2.hash, createdAt: at(20) });
  const e4 = await makeEvent({ treeId, seq: 4, type: 'status', payload: { status: 'cut', stumpDiameterCm: 50 }, userId: 'u1', deviceId, prevHash: e3.hash, createdAt: at(30) });
  return [e1, e2, e3, e4];
}

describe('canonicalJson', () => {
  it('sorts keys recursively, drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[3,{"y":2,"z":1}]},"b":1}');
  });
  it('is key-order independent', () => {
    expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson({ y: 2, x: 1 }));
  });
});

describe('hash chain', () => {
  it('makeEvent hashes and fills id/createdAt', async () => {
    const e = await makeEvent({ treeId: 't', seq: 1, type: 'void', payload: {}, userId: 'u', deviceId: 'd', prevHash: '' });
    expect(e.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(e.createdAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(e.hash).toMatch(/^[0-9a-f]{64}$/);
    const { hash, ...rest } = e;
    expect(await hashEvent(rest)).toBe(hash);
  });
  it('verifies a good chain, in any input order, across devices', async () => {
    const a = await chain('dev1', 'tree-1');
    const b = await chain('dev2', 'tree-2');
    expect(await verifyChain([...b, ...a].reverse())).toEqual({ ok: true });
  });
  it('detects a mutated payload', async () => {
    const evs = await chain();
    const tampered: TreeEvent[] = evs.map((e) => ({ ...e }));
    tampered[1] = { ...tampered[1], payload: { fields: { dbhCm: 80 } } };
    expect(await verifyChain(tampered)).toEqual({ ok: false, brokenAt: evs[1].id });
  });
  it('detects a removed event (broken prevHash link)', async () => {
    const evs = await chain();
    expect(await verifyChain([evs[0], evs[2], evs[3]])).toEqual({ ok: false, brokenAt: evs[2].id });
  });
  it('detects a re-hashed forged event', async () => {
    const evs = await chain();
    const { hash: _h, ...rest } = evs[1];
    const forged = { ...rest, payload: { fields: { dbhCm: 80 } } };
    const f = { ...forged, hash: await hashEvent(forged) };
    expect(await verifyChain([evs[0], f, evs[2], evs[3]])).toEqual({ ok: false, brokenAt: evs[2].id });
  });
  it('orders same-timestamp events by chain link', async () => {
    const ts = '2026-10-01T17:00:00.000Z';
    const e1 = await makeEvent({ treeId: 'b', seq: 1, type: 'void', payload: {}, userId: 'u', deviceId: 'd', prevHash: '', createdAt: ts });
    const e2 = await makeEvent({ treeId: 'a', seq: 1, type: 'void', payload: {}, userId: 'u', deviceId: 'd', prevHash: e1.hash, createdAt: ts });
    expect(await verifyChain([e2, e1])).toEqual({ ok: true });
  });
});

describe('foldEvents', () => {
  it('create -> update -> void -> status', async () => {
    const evs = await chain();
    const t1 = foldEvents(evs.slice(0, 1))!;
    expect(t1).toMatchObject({
      id: 'tree-1', tag: 'J-0001', tagNumber: 1, prefix: 'J', blockId: 'b1', lat: 50.7, lon: -120.35, accuracyM: 3, fixCount: 5,
      species: 'FD', dbhCm: 42, status: 'standing', voided: false, createdBy: 'u1', deviceId: 'dev1', version: 1,
    });
    const t2 = foldEvents(evs.slice(0, 2))!;
    expect(t2.dbhCm).toBe(44);
    expect(t2.defects).toBe('sweep');
    expect(t2.heightM).toBe(30);
    expect(t2.version).toBe(2);
    const t4 = foldEvents([...evs].reverse())!;
    expect(t4.voided).toBe(true);
    expect(t4.status).toBe('cut');
    expect(t4.stumpDiameterCm).toBe(50);
    expect(t4.version).toBe(4);
    expect(t4.updatedAt).toBe(evs[3].createdAt);
    expect(t4.createdAt).toBe(evs[0].createdAt);
  });
  it('null without create; duplicates ignored', async () => {
    const evs = await chain();
    expect(foldEvents(evs.slice(1))).toBeNull();
    expect(foldEvents([...evs, ...evs])!.version).toBe(4);
  });
  it('foldAll groups by tree', async () => {
    const a = await chain('dev1', uuid());
    const b = await chain('dev2', uuid());
    const trees = foldAll([...a, ...b.slice(0, 2)]);
    expect(trees).toHaveLength(2);
    expect(trees.find((t) => t.deviceId === 'dev2')!.voided).toBe(false);
    expect(trees.find((t) => t.deviceId === 'dev1')!.voided).toBe(true);
  });
});

describe('adjusted positions', () => {
  it('keeps the raw GPS fix when the pin was moved by hand', async () => {
    const e1 = await makeEvent({
      treeId: 'p', seq: 1, type: 'create', userId: 'u', deviceId: 'd', prevHash: '',
      payload: {
        tag: 'J-0009', tagNumber: 9, prefix: 'J',
        position: { lat: 50.70005, lon: -120.35, accuracyM: 4, fixCount: 3, positionSource: 'adjusted', gpsLat: 50.7, gpsLon: -120.35, gpsAccuracyM: 4 },
        fields: { species: 'FD' },
      },
    });
    const t = foldEvents([e1])!;
    expect(t).toMatchObject({ lat: 50.70005, lon: -120.35, positionSource: 'adjusted', gpsLat: 50.7, gpsLon: -120.35, gpsAccuracyM: 4 });
    const e2 = await makeEvent({
      treeId: 'p', seq: 2, type: 'update', userId: 'u', deviceId: 'd', prevHash: e1.hash,
      payload: { position: { lat: 50.7001, lon: -120.3501, accuracyM: 4, fixCount: 3, positionSource: 'adjusted', gpsLat: 50.7, gpsLon: -120.35, gpsAccuracyM: 4 } },
    });
    const t2 = foldEvents([e1, e2])!;
    expect(t2).toMatchObject({ lat: 50.7001, lon: -120.3501, positionSource: 'adjusted', gpsLat: 50.7 });
  });

  it('old events without a source fold as before', async () => {
    const [e1] = await chain();
    const t = foldEvents([e1])!;
    expect(t.positionSource).toBeUndefined();
    expect(t.lat).toBe(50.7);
  });
});
