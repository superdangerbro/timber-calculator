'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createColumnHelper, flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type SortingState,
} from '@tanstack/react-table';
import { SPECIES, SPECIES_COLORS, speciesName, type SpeciesCode, type Tree, type TreeStatus, type TreeValuation, type UserProfile } from '@timber/core';
import { money, num, shortDate } from '@/lib/format';

export interface Row { tree: Tree; val: TreeValuation; user?: UserProfile }
export type EditFn = (tree: Tree, change: { field: string; value: unknown }) => void;

type Kind = 'number' | 'scale' | 'species' | 'status';
const STATUSES: TreeStatus[] = ['standing', 'cut', 'damaged', 'missing'];

function EditableCell({ value, kind, display, onCommit, disabled, label }: {
  value: unknown; kind: Kind; display: React.ReactNode; onCommit: (v: unknown) => void; disabled?: boolean; label: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const ref = useRef<HTMLInputElement & HTMLSelectElement>(null);
  useEffect(() => { if (editing) { ref.current?.focus(); if (kind === 'number') ref.current?.select(); } }, [editing, kind]);
  if (disabled) return <span className="cell-ro">{display}</span>;
  if (!editing) {
    return (
      <button type="button" className="cell-edit" title={`Edit ${label}`} aria-label={`Edit ${label}`}
        onClick={(e) => { e.stopPropagation(); setDraft(value === undefined || value === null ? '' : String(value)); setEditing(true); }}>
        {display}
      </button>
    );
  }
  const commit = (raw: string) => {
    setEditing(false);
    if (raw === (value === undefined || value === null ? '' : String(value)) || raw === '') return;
    const v = kind === 'number' || kind === 'scale' ? Number(raw) : raw;
    if (kind === 'number' && (!Number.isFinite(v as number) || (v as number) <= 0)) return;
    onCommit(v);
  };
  const common = {
    ref, className: 'cell-input', 'data-testid': 'cell-input', 'aria-label': label,
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
      if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
      if (e.key === 'Escape') setEditing(false);
    },
  };
  if (kind === 'number') {
    return <input {...common} type="number" step="0.1" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={(e) => commit(e.target.value)} />;
  }
  const opts = kind === 'scale' ? ['1', '2', '3', '4', '5'] : kind === 'species' ? SPECIES.map((s) => s.code) : STATUSES;
  return (
    <select {...common} value={draft} onChange={(e) => commit(e.target.value)} onBlur={() => setEditing(false)}>
      {draft === '' && <option value="">—</option>}
      {opts.map((o) => <option key={o} value={o}>{kind === 'species' ? `${o} ${speciesName(o)}` : o}</option>)}
    </select>
  );
}

const col = createColumnHelper<Row>();

export function TreeTable({ rows, dupTags, selectedIds, onRowClick, onToggle, onToggleAll, onEdit, onHistory, onVoid, scrollToId }: {
  rows: Row[]; dupTags?: Set<string>; selectedIds: Set<string>;
  onRowClick: (id: string, additive: boolean) => void; onToggle: (id: string) => void; onToggleAll: (ids: string[] | null) => void;
  onEdit: EditFn; onHistory: (t: Tree) => void; onVoid: (t: Tree) => void; scrollToId: string | null;
}) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'tag', desc: false }]);
  const bodyRef = useRef<HTMLDivElement>(null);

  const columns = useMemo(() => {
    const ed = (field: string, kind: Kind, label: string, fmt: (r: Row) => React.ReactNode) =>
      (r: Row) => (
        <EditableCell kind={kind} label={`${label} for ${r.tree.tag}`} value={(r.tree as unknown as Record<string, unknown>)[field]} display={fmt(r)}
          disabled={r.tree.voided} onCommit={(v) => onEdit(r.tree, { field, value: v })} />
      );
    const scale = (f: 'straightness' | 'twist' | 'branchiness', label: string) =>
      col.accessor((r) => r.tree[f] ?? 0, {
        id: f, header: label, meta: { align: 'c', title: `${label} (5 = best)` },
        cell: (c) => ed(f, 'scale', label, (r) => r.tree[f] ? <span className={`score s${r.tree[f]}`}>{r.tree[f]}</span> : <span className="muted">—</span>)(c.row.original),
      });
    return [
      col.display({
        id: 'sel', header: () => null, meta: { className: 'col-sel' },
        cell: (c) => (
          <input type="checkbox" aria-label={`Select ${c.row.original.tree.tag}`} checked={selectedIds.has(c.row.original.tree.id)}
            onClick={(e) => e.stopPropagation()} onChange={() => onToggle(c.row.original.tree.id)} />
        ),
      }),
      // Natural order per prefix: main series J-0001, J-0002 ... then the leave series J-L0001 ...
      col.accessor((r) => `${r.tree.prefix}|${/-L\d+$/.test(r.tree.tag) ? 1 : 0}|${String(r.tree.tagNumber).padStart(6, '0')}|${r.tree.tag}`, {
        id: 'tag', header: 'Tag',
        cell: (c) => {
          const t = c.row.original.tree;
          const dup = !t.voided && dupTags?.has(t.tag);
          return (
            <span className="tag-cell">
              <span className={`tag${t.voided ? ' voided' : ''}`}>{t.tag}</span>
              {dup && <span className="dup-badge" title="Another live tree has this tag" data-testid="dup-badge">DUP</span>}
            </span>
          );
        },
      }),
      col.accessor((r) => r.tree.species ?? '', {
        id: 'species', header: 'Species',
        cell: (c) => ed('species', 'species', 'Species', (r) => r.tree.species
          ? <span className="sp"><span className="dot" style={{ background: SPECIES_COLORS[r.tree.species as SpeciesCode] }} />{r.tree.species}</span>
          : <span className="muted">—</span>)(c.row.original),
      }),
      col.accessor((r) => r.tree.dbhCm ?? 0, {
        id: 'dbh', header: 'DBH cm', meta: { align: 'r' },
        cell: (c) => ed('dbhCm', 'number', 'DBH', (r) => num(r.tree.dbhCm, 0))(c.row.original),
      }),
      col.accessor((r) => r.tree.heightM ?? 0, {
        id: 'height', header: 'Ht m', meta: { align: 'r' },
        cell: (c) => ed('heightM', 'number', 'Height', (r) => num(r.tree.heightM, 1))(c.row.original),
      }),
      scale('straightness', 'Straight'),
      scale('twist', 'Twist'),
      scale('branchiness', 'Branch'),
      col.accessor((r) => r.val.product, {
        id: 'product', header: 'Product',
        cell: (c) => { const r = c.row.original; return r.tree.leaveTree ? <span className="badge none">Leave</span> : <span className={`badge ${r.val.product}`}>{r.val.product === 'none' ? '—' : r.val.product === 'pole' ? 'Pole' : 'Sawlog'}</span>; },
      }),
      col.accessor((r) => r.val.poleClass ?? '', { id: 'poleClass', header: 'Class', cell: (c) => c.getValue() ? String(c.getValue()).replace('Class ', 'C') : <span className="muted">—</span> }),
      col.accessor((r) => r.val.volumeM3, { id: 'volume', header: 'Vol m³', meta: { align: 'r' }, cell: (c) => num(c.getValue(), 2) }),
      col.accessor((r) => r.val.value, { id: 'value', header: 'Value', meta: { align: 'r' }, cell: (c) => <b className="money">{money(c.getValue())}</b> }),
      col.accessor((r) => r.tree.status, {
        id: 'status', header: 'Status',
        cell: (c) => ed('status', 'status', 'Status', (r) => <span className={`status st-${r.tree.status}`}>{r.tree.status}</span>)(c.row.original),
      }),
      col.accessor((r) => r.user?.name ?? r.tree.createdBy, {
        id: 'markedBy', header: 'Marked by',
        cell: (c) => { const u = c.row.original.user; return <span className="who-cell"><span className="prefix-chip sm">{u?.tagPrefix ?? c.row.original.tree.prefix}</span>{u?.name.split(' ')[0] ?? 'Unknown'}</span>; },
      }),
      col.accessor((r) => r.tree.createdAt, { id: 'date', header: 'Date', cell: (c) => <span className="nowrap">{shortDate(c.getValue())}</span> }),
      col.accessor((r) => r.tree.accuracyM, { id: 'accuracy', header: 'GPS ±m', meta: { align: 'r' }, cell: (c) => <span className={c.getValue() > 6 ? 'warn' : ''}>{num(c.getValue(), 1)}</span> }),
      col.display({
        id: 'actions', header: () => null, meta: { className: 'col-actions' },
        cell: (c) => (
          <span className="row-actions">
            <button className="btn ghost small" onClick={(e) => { e.stopPropagation(); onHistory(c.row.original.tree); }} title="Event history">History</button>
            {!c.row.original.tree.voided && (
              <button className="btn ghost small danger-text" onClick={(e) => { e.stopPropagation(); onVoid(c.row.original.tree); }} title="Void this tree">Void</button>
            )}
          </span>
        ),
      }),
    ];
  }, [selectedIds, dupTags, onEdit, onHistory, onVoid, onToggle]);

  const table = useReactTable({
    data: rows, columns, state: { sorting }, onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getRowId: (r) => r.tree.id,
  });

  useEffect(() => {
    if (!scrollToId || !bodyRef.current) return;
    const el = bodyRef.current.querySelector(`[data-row-id="${scrollToId}"]`) as HTMLElement | null;
    if (!el) return;
    const box = bodyRef.current.getBoundingClientRect(); const r = el.getBoundingClientRect();
    if (r.top < box.top + 36 || r.bottom > box.bottom) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [scrollToId]);

  const allIds = rows.map((r) => r.tree.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id));

  return (
    <div className="table-scroll" ref={bodyRef} data-testid="tree-table">
      <table className="grid">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => {
                const meta = (h.column.columnDef.meta ?? {}) as { align?: string; className?: string; title?: string };
                const sort = h.column.getIsSorted();
                return (
                  <th key={h.id} className={`${meta.align ? 'a-' + meta.align : ''} ${meta.className ?? ''}`} title={meta.title}
                    aria-sort={sort === 'asc' ? 'ascending' : sort === 'desc' ? 'descending' : undefined}>
                    {h.column.id === 'sel' ? (
                      <input type="checkbox" aria-label="Select all" checked={allSelected} onChange={() => onToggleAll(allSelected ? null : allIds)} />
                    ) : h.column.getCanSort() ? (
                      <button className="th-sort" onClick={h.column.getToggleSortingHandler()}>
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        <span className="arrow">{sort === 'asc' ? '▲' : sort === 'desc' ? '▼' : ''}</span>
                      </button>
                    ) : flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => {
            const t = row.original.tree;
            return (
              <tr key={row.id} data-row-id={t.id} data-testid="tree-row"
                className={`${selectedIds.has(t.id) ? 'sel' : ''}${t.voided ? ' voided' : ''}`}
                onClick={(e) => onRowClick(t.id, e.shiftKey || e.metaKey || e.ctrlKey)}>
                {row.getVisibleCells().map((cell) => {
                  const meta = (cell.column.columnDef.meta ?? {}) as { align?: string; className?: string };
                  return <td key={cell.id} className={`${meta.align ? 'a-' + meta.align : ''} ${meta.className ?? ''}`}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>;
                })}
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr><td colSpan={columns.length} className="empty">No trees match the filters in this area. Try resetting filters or clearing the area.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
