import { useEffect, useRef, useState, type ReactNode } from 'react';
import { SPECIES, SPECIES_COLORS, type Scale, type SpeciesCode, type TreeFields } from '@timber/core';
import { Icon } from './Icon';

export type FieldKey = 'species' | 'dbhCm' | 'heightM' | 'straightness' | 'twist' | 'branchiness' | 'defects' | 'leaveTree' | 'notes';

export const FIELD_META: Record<FieldKey, { label: string; short: string; unit?: string; kind: 'species' | 'number' | 'scale' | 'text' | 'bool' }> = {
  species: { label: 'Species', short: 'Species', kind: 'species' },
  dbhCm: { label: 'DBH', short: 'DBH', unit: 'cm', kind: 'number' },
  heightM: { label: 'Height', short: 'Height', unit: 'm', kind: 'number' },
  straightness: { label: 'Straightness', short: 'Straight', kind: 'scale' },
  twist: { label: 'Twist', short: 'Twist', kind: 'scale' },
  branchiness: { label: 'Branchiness', short: 'Branchy', kind: 'scale' },
  defects: { label: 'Defects', short: 'Defects', kind: 'text' },
  leaveTree: { label: 'Leave tree', short: 'Leave', kind: 'bool' },
  notes: { label: 'Notes', short: 'Notes', kind: 'text' },
};

export const SCALE_HINT: Record<'straightness' | 'twist' | 'branchiness', string[]> = {
  straightness: ['', 'crooked', 'poor', 'fair', 'good', 'dead straight'],
  twist: ['', 'severe', 'bad', 'some', 'slight', 'none'],
  branchiness: ['', 'very limby', 'limby', 'some', 'few', 'clean'],
};

export function speciesColor(code?: string) {
  return (code && (SPECIES_COLORS as Record<string, string> | undefined)?.[code]) || '#cfd8d3';
}

export function speciesLabel(code?: string) {
  return SPECIES?.find((s) => s.code === code)?.name ?? code ?? '';
}

export function SpeciesDot({ code, size = 14 }: { code?: string; size?: number }) {
  return <span className="sp-dot" style={{ width: size, height: size, background: speciesColor(code) }} />;
}

export function formatField(key: FieldKey, f: TreeFields): string | null {
  const v = f[key as keyof TreeFields];
  if (v === undefined || v === null || v === '') return null;
  if (key === 'leaveTree') return v ? 'Yes' : 'No';
  if (key === 'dbhCm' || key === 'heightM') return `${Math.round((v as number) * 10) / 10}`;
  return String(v);
}

export function Modal({ title, onClose, children, testId }: { title: string; onClose: () => void; children: ReactNode; testId?: string }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} data-testid={testId} role="dialog" aria-label={title}>
        <div className="modal-head">
          <div className="modal-title">{title}</div>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/** Big-target editor for one tree field. onChange(undefined) clears it. */
export function FieldEditor({
  field,
  value,
  onChange,
  onClose,
}: {
  field: FieldKey;
  value: TreeFields;
  onChange: (patch: TreeFields) => void;
  onClose: () => void;
}) {
  const meta = FIELD_META[field];
  const [text, setText] = useState(() => {
    const v = value[field as keyof TreeFields];
    return v === undefined ? '' : String(v);
  });
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (meta.kind === 'number' || meta.kind === 'text') input.current?.focus();
  }, [meta.kind]);

  const commitText = () => {
    if (meta.kind === 'number') {
      const n = parseFloat(text.replace(',', '.'));
      onChange({ [field]: Number.isFinite(n) && n > 0 ? n : undefined, ...(field === 'heightM' && Number.isFinite(n) ? { heightSource: 'estimated' as const } : {}) });
    } else {
      onChange({ [field]: text.trim() || undefined });
    }
    onClose();
  };

  return (
    <Modal title={meta.label} onClose={onClose} testId={`editor-${field}`}>
      {meta.kind === 'species' && (
        <div className="species-grid">
          {(SPECIES ?? []).map((s) => (
            <button
              key={s.code}
              className={value.species === s.code ? 'species-btn on' : 'species-btn'}
              onClick={() => {
                onChange({ species: s.code as SpeciesCode });
                onClose();
              }}
            >
              <SpeciesDot code={s.code} size={18} />
              <span className="species-code">{s.code}</span>
              <span className="species-name">{s.name}</span>
            </button>
          ))}
        </div>
      )}
      {meta.kind === 'scale' && (
        <div className="scale-row">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              className={value[field as 'twist'] === n ? 'scale-btn on' : 'scale-btn'}
              onClick={() => {
                onChange({ [field]: n as Scale });
                onClose();
              }}
            >
              <span className="scale-n">{n}</span>
              <span className="scale-hint">{SCALE_HINT[field as 'twist'][n]}</span>
            </button>
          ))}
        </div>
      )}
      {meta.kind === 'bool' && (
        <div className="bool-row">
          {[true, false].map((b) => (
            <button
              key={String(b)}
              className={!!value.leaveTree === b ? 'big-choice on' : 'big-choice'}
              onClick={() => {
                onChange({ leaveTree: b ? true : undefined });
                onClose();
              }}
            >
              {b ? 'Leave tree' : 'Normal tree'}
            </button>
          ))}
        </div>
      )}
      {(meta.kind === 'number' || meta.kind === 'text') && (
        <form
          className="edit-form"
          onSubmit={(e) => {
            e.preventDefault();
            commitText();
          }}
        >
          <div className="edit-input-wrap">
            <input
              ref={input}
              className="edit-input"
              inputMode={meta.kind === 'number' ? 'decimal' : 'text'}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={meta.kind === 'number' ? '0' : field === 'defects' ? 'e.g. sweep; conk' : ''}
              data-testid={`input-${field}`}
            />
            {meta.unit && <span className="edit-unit">{meta.unit}</span>}
          </div>
          <div className="edit-actions">
            <button type="button" className="btn ghost" onClick={() => { onChange({ [field]: undefined }); onClose(); }}>
              Clear
            </button>
            <button type="submit" className="btn primary">
              Set
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export const FORM_FIELDS: FieldKey[] = ['species', 'dbhCm', 'heightM', 'straightness', 'twist', 'branchiness', 'defects', 'leaveTree'];

/** Grid of big tiles showing a TreeFields; tap a tile to edit. */
export function FieldGrid({
  fields,
  missing,
  onEdit,
  compact,
}: {
  fields: TreeFields;
  missing?: (keyof TreeFields)[];
  onEdit: (k: FieldKey) => void;
  compact?: boolean;
}) {
  return (
    <div className={compact ? 'field-grid compact' : 'field-grid'}>
      {FORM_FIELDS.map((k) => {
        const meta = FIELD_META[k];
        const val = formatField(k, fields);
        const isMissing = missing?.includes(k as keyof TreeFields);
        const wide = k === 'defects';
        return (
          <button
            key={k}
            className={`field-tile${isMissing ? ' missing' : ''}${val ? ' has' : ''}${wide ? ' wide' : ''}`}
            onClick={() => onEdit(k)}
            data-testid={`field-${k}`}
          >
            <span className="field-label">{meta.short}</span>
            <span className="field-value">
              {k === 'species' && val ? (
                <>
                  <SpeciesDot code={fields.species} size={16} />
                  {val}
                </>
              ) : k === 'leaveTree' ? (
                fields.leaveTree ? <span className="leave-yes">LEAVE</span> : <span className="dim">no</span>
              ) : val ? (
                <>
                  <span className={k === 'defects' ? 'defects-text' : ''}>{val}</span>
                  {meta.unit && <span className="unit">{meta.unit}</span>}
                  {k === 'heightM' && fields.heightSource === 'clinometer' && <span className="src">clino</span>}
                </>
              ) : isMissing ? (
                <span className="missing-text">missing</span>
              ) : (
                <span className="dim">—</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
