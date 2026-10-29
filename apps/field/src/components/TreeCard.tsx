import { useState } from 'react';
import type { Tree } from '@timber/core';
import { useApp } from '../app';
import { useEmitter } from '../lib/emitter';
import { girthText, heightText } from '../lib/units';
import { money, safeValue } from '../lib/valuation';
import { Modal, SpeciesDot, speciesLabel } from './fields';
import { PhotoButtons, PhotoThumb, PhotoViewer } from './Photos';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

/** Everything about one tree, opened by tapping its dot on the map. */
export function TreeCard({ tree, onClose }: { tree: Tree; onClose: () => void }) {
  const { repo } = useApp();
  const r = useEmitter(repo);
  const live = r.trees.find((t) => t.id === tree.id) ?? tree;
  const units = r.settings.units;
  const v = safeValue(live, repo.scenario);
  const [viewing, setViewing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const mine = live.deviceId === r.settings.deviceId;
  const sc = (n?: number) => (n ? String(n) : '–');
  const photos = live.photos ?? [];

  return (
    <Modal title={live.tag} onClose={onClose} testId="tree-card">
      <div className="card-sp">
        <SpeciesDot code={live.species} size={18} />
        <span>{live.species ? speciesLabel(live.species) : 'Species not recorded'}</span>
        {live.leaveTree && <span className="pill leave">Leave</span>}
        {live.voided && <span className="pill void">Void</span>}
      </div>

      {photos.length > 0 && (
        <div className="card-photos" data-testid="card-photos">
          {photos.map((p, i) => (
            <PhotoThumb key={p.id} photoId={p.id} big={i === 0} onOpen={() => setViewing(p.id)} />
          ))}
        </div>
      )}

      <dl className="card-grid">
        {live.circumferenceCm ? (
          <>
            <dt>Circumference</dt>
            <dd data-testid="card-circ">{girthText(live.circumferenceCm, units)}</dd>
          </>
        ) : null}
        <dt>DBH</dt>
        <dd data-testid="card-dbh">{girthText(live.dbhCm, units)}</dd>
        <dt>Height</dt>
        <dd>
          {heightText(live.heightM, units)}
          {live.heightSource === 'clinometer' ? ' · clino' : ''}
        </dd>
        <dt>Str / Tw / Br</dt>
        <dd>
          {sc(live.straightness)} / {sc(live.twist)} / {sc(live.branchiness)}
        </dd>
        <dt>Product</dt>
        <dd>{v.product === 'pole' ? `Pole ${v.poleClass?.replace('Class ', 'C') ?? ''}` : v.product === 'sawlog' ? 'Sawlog' : '—'}</dd>
        <dt>Volume</dt>
        <dd>{v.volumeM3.toFixed(2)} m³</dd>
        <dt>Value</dt>
        <dd data-testid="card-value">{v.product === 'none' ? '—' : v.priced ? money(v.value) : <span className="dim">prices not set</span>}</dd>
        <dt>Status</dt>
        <dd className={`st-${live.status}`}>{live.status}</dd>
        {live.defects ? (
          <>
            <dt>Defects</dt>
            <dd>{live.defects}</dd>
          </>
        ) : null}
        <dt>Marked</dt>
        <dd>
          {mine ? 'on this phone' : 'on another device'} · {when(live.createdAt)}
        </dd>
        <dt>GPS</dt>
        <dd>
          ±{Number.isFinite(live.accuracyM) ? live.accuracyM.toFixed(1) : "?"} m · {live.fixCount} {live.fixCount === 1 ? "fix" : "fixes"}
        </dd>
      </dl>

      {!live.voided &&
        (adding ? (
          <PhotoButtons tree={live} onSaved={(ok) => ok && setAdding(false)} />
        ) : (
          <button className="btn ghost wide" onClick={() => setAdding(true)} data-testid="card-add-photo">
            {photos.length ? 'Add another photo' : 'Add photo'}
          </button>
        ))}

      {viewing && <PhotoViewer photoId={viewing} onClose={() => setViewing(null)} />}
    </Modal>
  );
}
