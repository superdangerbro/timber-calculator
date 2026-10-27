import { useMemo, useState } from 'react';
import type { SpeciesCode, Tree, TreeFields } from '@timber/core';
import { ClashBanner } from '../components/ClashBanner';
import { useApp } from '../app';
import { useEmitter } from '../lib/emitter';
import { Icon } from '../components/Icon';
import { FieldEditor, FieldGrid, Modal, SpeciesDot, speciesLabel, type FieldKey } from '../components/fields';
import { isToday } from '../state/repo';
import { money, safeSummary, safeValue, sawlogM3 } from '../lib/valuation';

type Product = 'all' | 'pole' | 'sawlog' | 'none';

const FIELD_KEYS: (keyof TreeFields)[] = ['species', 'dbhCm', 'heightM', 'heightSource', 'straightness', 'twist', 'branchiness', 'defects', 'leaveTree', 'notes'];

function TreeEditor({ tree, onClose }: { tree: Tree; onClose: () => void }) {
  const { repo } = useApp();
  const [draft, setDraft] = useState<TreeFields>(() => {
    const f: TreeFields = {};
    for (const k of FIELD_KEYS) if (tree[k] !== undefined && tree[k] !== null) (f as any)[k] = tree[k];
    return f;
  });
  const [editing, setEditing] = useState<FieldKey | null>(null);
  const [confirmVoid, setConfirmVoid] = useState(false);

  const changed = useMemo(() => {
    const out: TreeFields = {};
    for (const k of FIELD_KEYS) {
      const a = (tree as any)[k] ?? undefined;
      const b = (draft as any)[k] ?? undefined;
      if (a !== b) (out as any)[k] = b ?? null;
    }
    return out;
  }, [draft, tree]);
  const dirty = Object.keys(changed).length > 0;

  return (
    <Modal title={`Edit ${tree.tag}`} onClose={onClose} testId="tree-editor">
      <div className="editor-meta">
        <span>{new Date(tree.createdAt).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}</span>
        <span>±{tree.accuracyM?.toFixed?.(1) ?? '?'} m · {tree.fixCount} fix{tree.fixCount === 1 ? '' : 'es'}</span>
        <span>v{tree.version}</span>
      </div>
      <FieldGrid
        fields={draft}
        onEdit={setEditing}
        compact
      />
      <div className="edit-actions spaced">
        {tree.voided ? (
          <div className="voided-note">Voided — number {tree.tag} is retired</div>
        ) : confirmVoid ? (
          <button
            className="btn danger big grow"
            data-testid="confirm-void"
            onClick={async () => {
              await repo.voidTree(tree.id, 'voided in list');
              onClose();
            }}
          >
            Confirm void {tree.tag}
          </button>
        ) : (
          <button className="btn ghost big" onClick={() => setConfirmVoid(true)} data-testid="void">
            <Icon name="trash" size={20} /> Void
          </button>
        )}
        {!confirmVoid && !tree.voided && (
          <button
            className="btn primary big grow"
            disabled={!dirty}
            data-testid="save-edit"
            onClick={async () => {
              await repo.updateTree(tree.id, changed);
              onClose();
            }}
          >
            Save changes
          </button>
        )}
      </div>
      {editing && (
        <FieldEditor
          field={editing}
          value={draft}
          onChange={(p) => setDraft((d) => {
            const n = { ...d, ...p };
            for (const k of Object.keys(n)) if ((n as any)[k] === undefined) delete (n as any)[k];
            return n;
          })}
          onClose={() => setEditing(null)}
        />
      )}
    </Modal>
  );
}

export function TreesScreen() {
  const { repo } = useApp();
  const r = useEmitter(repo);
  const [when, setWhen] = useState<'today' | 'all'>('today');
  const [species, setSpecies] = useState<SpeciesCode | 'all'>('all');
  const [product, setProduct] = useState<Product>('all');
  const [showVoid, setShowVoid] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const scenario = repo.scenario;

  const rows = useMemo(() => {
    return r.trees
      .filter((t) => (when === 'today' ? isToday(t.createdAt) : true))
      .filter((t) => showVoid || !t.voided)
      .filter((t) => species === 'all' || t.species === species)
      .map((t) => ({ t, v: safeValue(t, scenario) }))
      .filter(({ v }) => product === 'all' || v.product === product);
  }, [r.trees, when, species, product, showVoid, scenario]);

  const presentSpecies = useMemo(
    () => [...new Set(r.trees.filter((t) => t.species).map((t) => t.species!))].sort(),
    [r.trees],
  );
  const summary = useMemo(() => safeSummary(rows.map((x) => x.t).filter((t) => !t.voided), scenario), [rows, scenario]);
  const editTree = editId ? r.trees.find((t) => t.id === editId) : null;

  return (
    <div className="page" data-testid="trees-screen">
      <header className="page-head">
        <h1>Trees</h1>
        <div className="seg">
          {(['today', 'all'] as const).map((w) => (
            <button key={w} className={when === w ? 'on' : ''} onClick={() => setWhen(w)} data-testid={`when-${w}`}>
              {w === 'today' ? 'Today' : 'All'}
            </button>
          ))}
        </div>
      </header>
      <ClashBanner showResult />

      <div className="filters">
        <div className="chip-scroll">
          <button className={species === 'all' ? 'fchip on' : 'fchip'} onClick={() => setSpecies('all')}>
            All species
          </button>
          {presentSpecies.map((s) => (
            <button key={s} className={species === s ? 'fchip on' : 'fchip'} onClick={() => setSpecies(s)} data-testid={`sp-${s}`}>
              <SpeciesDot code={s} /> {s}
            </button>
          ))}
        </div>
        <div className="seg wide">
          {(['all', 'pole', 'sawlog', 'none'] as const).map((p) => (
            <button key={p} className={product === p ? 'on' : ''} onClick={() => setProduct(p)} data-testid={`prod-${p}`}>
              {p === 'all' ? 'Any' : p === 'none' ? 'Leave/none' : p[0].toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="summary-bar">
        <span>
          <b>{summary.treeCount}</b> trees
        </span>
        <span>
          <b>{summary.poleCount}</b> poles
        </span>
        <span>
          <b>{sawlogM3(summary).toFixed(1)}</b> m³
        </span>
        <span>
          <b>{money(summary.totalValue)}</b>
        </span>
        <label className="void-toggle">
          <input type="checkbox" checked={showVoid} onChange={(e) => setShowVoid(e.target.checked)} /> voids
        </label>
      </div>

      <ul className="tree-list" data-testid="tree-list">
        {rows.length === 0 && <li className="empty">No trees match. Tally some on the Tally tab.</li>}
        {rows.map(({ t, v }) => (
          <li key={t.id}>
            <button className={`tree-row${t.voided ? ' voided' : ''}`} onClick={() => setEditId(t.id)} data-testid={`row-${t.tag}`}>
              <div className={t.tag.length > 7 ? 'tr-tag long' : 'tr-tag'}>{t.tag}</div>
              <div className="tr-main">
                <div className="tr-species">
                  <SpeciesDot code={t.species} />
                  <span className="tr-sp-name">{speciesLabel(t.species) || 'No species'}</span>
                  {t.leaveTree && <span className="badge leave">LEAVE</span>}
                  {t.status !== 'standing' && <span className={`badge st-${t.status}`}>{t.status}</span>}
                </div>
                <div className="tr-dims">
                  {t.dbhCm ?? '—'} cm · {t.heightM ?? '—'} m · S{t.straightness ?? '-'} T{t.twist ?? '-'} B{t.branchiness ?? '-'}
                  {t.defects ? ` · ${t.defects}` : ''}
                </div>
              </div>
              <div className="tr-value">
                <div className={`prod ${v.product}`}>{v.product === 'pole' ? v.poleClass ?? 'Pole' : v.product === 'none' ? '—' : 'Sawlog'}</div>
                <div className="tr-money">{t.voided ? 'void' : money(v.value)}</div>
              </div>
            </button>
          </li>
        ))}
      </ul>
      {editTree && <TreeEditor tree={editTree} onClose={() => setEditId(null)} />}
    </div>
  );
}
