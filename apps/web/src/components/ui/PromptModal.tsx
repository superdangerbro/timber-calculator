'use client';
import { useState } from 'react';
import { Modal } from './Modal';

export interface PromptField { key: string; label: string; placeholder?: string; initial?: string; maxLength?: number }

export function PromptModal({ title, fields, confirm, onClose, onSubmit, children }: {
  title: string; fields: PromptField[]; confirm: string; onClose: () => void; onSubmit: (v: Record<string, string>) => void; children?: React.ReactNode;
}) {
  const [vals, setVals] = useState<Record<string, string>>(Object.fromEntries(fields.map((f) => [f.key, f.initial ?? ''])));
  const ok = vals[fields[0].key]?.trim();
  const submit = () => { if (ok) onSubmit(Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, v.trim()]))); };
  return (
    <Modal title={title} onClose={onClose} width={440}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!ok} onClick={submit} data-testid="prompt-confirm">{confirm}</button></>}>
      {children}
      <div style={{ display: 'grid', gap: 12 }}>
        {fields.map((f, i) => (
          <div key={f.key}>
            <label className="label" htmlFor={`pf-${f.key}`}>{f.label}</label>
            <input id={`pf-${f.key}`} className="input" style={{ width: '100%' }} autoFocus={i === 0} placeholder={f.placeholder} maxLength={f.maxLength}
              value={vals[f.key]} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              data-testid={`prompt-${f.key}`} />
          </div>
        ))}
      </div>
    </Modal>
  );
}
