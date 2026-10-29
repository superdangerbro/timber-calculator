'use client';
import { useEffect, useState } from 'react';
import type { Tree, TreeEvent, UserProfile } from '@timber/core';
import { shortDate } from '@/lib/format';
import { Modal } from '../ui/Modal';

type Hist = { events: (TreeEvent & { serverSeq: number; receivedAt: string })[]; verification: { ok: boolean; brokenAt?: string } };

function describe(e: TreeEvent): string {
  const p = e.payload as Record<string, unknown>;
  if (e.type === 'create') {
    const f = (p.fields ?? {}) as Record<string, unknown>;
    return `Created ${p.tag ?? ''}: ` + Object.entries(f).map(([k, v]) => `${k} ${v}`).join(', ');
  }
  if (e.type === 'update' && Array.isArray(p.photos) && !p.fields) return `Added ${p.photos.length === 1 ? 'a photo' : `${p.photos.length} photos`}`;
  if (e.type === 'update') return 'Changed ' + Object.entries((p.fields ?? {}) as Record<string, unknown>).map(([k, v]) => `${k} → ${v}`).join(', ');
  if (e.type === 'void') return `Voided${p.reason ? `: ${p.reason}` : ''}`;
  if (e.type === 'status') return `Status → ${p.status}${p.stumpDiameterCm ? ` (stump ${p.stumpDiameterCm} cm)` : ''}`;
  return JSON.stringify(p);
}

export function HistoryModal({ tree, users, onClose, version }: { tree: Tree; users: Map<string, UserProfile>; onClose: () => void; version: number }) {
  const [data, setData] = useState<Hist | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/trees/${tree.id}/events`).then(async (r) => {
      const b = await r.json();
      if (!r.ok) throw new Error(b.error ?? 'Failed to load history');
      if (live) setData(b);
    }).catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [tree.id, version]);

  return (
    <Modal width={680} onClose={onClose} title={<><span className="tag">{tree.tag}</span> history</>}>
      {err && <div className="auth-err">{err}</div>}
      {!data && !err && <p className="muted">Loading events…</p>}
      {data && (
        <>
          <div className="hist-head">
            {data.verification.ok
              ? <span className="badge ok" data-testid="chain-verified">✓ Chain verified</span>
              : <span className="badge bad" data-testid="chain-broken">✕ Chain broken at {data.verification.brokenAt?.slice(0, 8)}</span>}
            <span className="muted">{data.events.length} events · hash-chained per device, recomputed on the server</span>
          </div>
          {!!tree.photos?.length && (
            <div className="hist-photos" data-testid="history-photos">
              {tree.photos.map((ph) => (
                <button key={ph.id} type="button" className="hist-photo" data-photo={ph.id} title={`Taken ${shortDate(ph.takenAt)} · sha256 ${ph.sha256.slice(0, 12)}…`}>
                  <img src={`/api/photos/${ph.id}`} alt={`Photo of ${tree.tag}`} loading="lazy" />
                </button>
              ))}
            </div>
          )}
          <ol className="timeline" data-testid="history-list">
            {data.events.map((e) => {
              const u = users.get(e.userId);
              return (
                <li key={e.id} className={`ev ev-${e.type}`}>
                  <div className="ev-top">
                    <span className={`ev-type t-${e.type}`}>{e.type}</span>
                    <b>{u ? `${u.name} (${u.tagPrefix})` : e.userId.slice(0, 8)}</b>
                    <span className="muted">on {e.deviceId === 'web' ? 'dashboard' : e.deviceId}</span>
                    <span className="muted grow-r">{shortDate(e.createdAt)}</span>
                  </div>
                  <div className="ev-desc">{describe(e)}</div>
                  <div className="ev-hash mono" title={`hash ${e.hash}\nprev ${e.prevHash || '(first on device)'}`}>#{e.seq} · {e.hash.slice(0, 16)}… ← {e.prevHash ? e.prevHash.slice(0, 10) + '…' : 'genesis'}</div>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </Modal>
  );
}
