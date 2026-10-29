import { useEffect, useRef, useState, type ReactNode } from 'react';
import { SPECIES, SPECIES_COLORS, type Scale, type SpeciesCode, type TreeFields, type UnitSystem } from '@timber/core';
import { dbhFromCirc, girthToCm, girthUnit, heightToM, heightUnit, showGirth, showHeight } from '../lib/units';
import { Icon } from './Icon';

export type FieldKey = 'species' | 'circumferenceCm' | 'dbhCm' | 'heightM' | 'straightness' | 'twist' | 'branchiness' | 'defects' | 'leaveTree' | 'notes';

export const FIELD_META: Record<FieldKey, { label: string; short: string; unit?: string; kind: 'species' | 'number' | 'scale' | 'text' | 'bool' }> = {
  species: { label: 'Species', short: 'Species', kind: 'species' },
  circumferenceCm: { label: 'Circumference', short: 'Circumf.', unit: 'cm', kind: 'number' },
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

/** Unit label for a field under the chosen display units. */
export function fieldUnit(key: FieldKey, units: UnitSystem = 'metric'): string | undefined {
  if (key === 'dbhCm' || key === 'circumferenceCm') return girthUnit(units);
  if (key === 'heightM') return heightUnit(units);
  return FIELD_META[key].unit;
}

export function formatField(key: FieldKey, f: TreeFields, units: UnitSystem = 'metric'): string | null {
  const v = f[key as keyof TreeFields];
  if (v === undefined || v === null || v === '') return null;
  if (key === 'leaveTree') return v ? 'Yes' : 'No';
  if (key === 'dbhCm' || key === 'circumferenceCm') return `${showGirth(v as number, units)}`;
  if (key === 'heightM') return `${showHeight(v as number, units)}`;
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
  units = 'metric',
}: {
  field: FieldKey;
  value: TreeFields;
  onChange: (patch: TreeFields) => void;
  onClose: () => void;
  units?: UnitSystem;
}) {
  const meta = FIELD_META[field];
  const unit = fieldUnit(field, units);
  const [text, setText] = useState(() => formatField(field, value, units) ?? '');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (meta.kind === 'number' || meta.kind === 'text') input.current?.focus();
  }, [meta.kind]);

  const commitText = () => {
    if (meta.kind === 'number') {
      const n = parseFloat(text.replace(',', '.'));
      const ok = Number.isFinite(n) && n > 0;
      if (field === 'circumferenceCm') {
        // DBH is derived from the taped circumference.
        const c = ok ? girthToCm(n, units) : null;
        onChange(c ? { circumferenceCm: c, dbhCm: dbhFromCirc(c) } : { circumferenceCm: null });
      } else if (field === 'dbhCm') {
        // A DBH typed directly replaces any circumference it came from.
        onChange({ dbhCm: ok ? girthToCm(n, units) : undefined, circumferenceCm: null });
      } else if (field === 'heightM') {
        onChange({ heightM: ok ? heightToM(n, units) : undefined, ...(ok ? { heightSource: 'estimated' as const } : {}) });
      } else {
        onChange({ [field]: ok ? n : undefined });
      }
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
            {unit && <span className="edit-unit">{unit}</span>}
          </div>
          {field === 'circumferenceCm' && (
            <div className="edit-derived" data-testid="derived-dbh">
              {(() => {
                const n = parseFloat(text.replace(',', '.'));
                if (!Number.isFinite(n) || n <= 0) return 'DBH is worked out from the circumference (C ÷ π).';
                return `DBH ${showGirth(dbhFromCirc(girthToCm(n, units)), units)} ${unit}`;
              })()}
            </div>
          )}
          <div className="edit-actions">
            <button type="button" className="btn ghost" onClick={() => { onChange(field === 'circumferenceCm' ? { circumferenceCm: null } : { [field]: undefined }); onClose(); }}>
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

export const FORM_FIELDS: FieldKey[] = ['species', 'circumferenceCm', 'dbhCm', 'heightM', 'straightness', 'twist', 'branchiness', 'defects', 'leaveTree'];

/** Grid of big tiles showing a TreeFields; tap a tile to edit. */
export function FieldGrid({
  fields,
  missing,
  onEdit,
  compact,
  units = 'metric',
  measure = 'dbh',
}: {
  fields: TreeFields;
  missing?: (keyof TreeFields)[];
  onEdit: (k: FieldKey) => void;
  compact?: boolean;
  units?: UnitSystem;
  measure?: 'circumference' | 'dbh';
}) {
  return (
    <div className={compact ? 'field-grid compact' : 'field-grid'}>
      {FORM_FIELDS.map((k) => {
        const meta = FIELD_META[k];
        const val = formatField(k, fields, units);
        const unit = fieldUnit(k, units);
        // A taped circumference satisfies "DBH missing" (DBH is derived from it).
        const girthMissing = !!missing?.includes('dbhCm');
        const isMissing =
          k === 'circumferenceCm' ? measure === 'circumference' && girthMissing
          : k === 'dbhCm' ? measure !== 'circumference' && girthMissing
          : missing?.includes(k as keyof TreeFields);
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
                  {unit && <span className="unit">{unit}</span>}
                  {k === 'heightM' && fields.heightSource === 'clinometer' && <span className="src">clino</span>}
                  {k === 'dbhCm' && fields.circumferenceCm ? <span className="src">calc</span> : null}
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
