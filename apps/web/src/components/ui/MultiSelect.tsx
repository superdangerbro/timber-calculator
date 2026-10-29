'use client';
import { useEffect, useRef, useState } from 'react';

export function MultiSelect<T extends string>({ label, options, value, onChange, testId }: {
  label: string; options: { value: T; label: React.ReactNode }[]; value: T[]; onChange: (v: T[]) => void; testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const summary = value.length === 0 ? 'All' : value.length === 1 ? String(options.find((o) => o.value === value[0])?.label ?? value[0]) : `${value.length} selected`;
  return (
    <div className="ms" ref={ref} data-testid={testId}>
      <button type="button" className={`select ms-btn${value.length ? ' on' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="ms-label">{label}</span> {summary}
      </button>
      {open && (
        <div className="ms-menu">
          {options.map((o) => (
            <label key={o.value} className="ms-item">
              <input type="checkbox" checked={value.includes(o.value)}
                onChange={(e) => onChange(e.target.checked ? [...value, o.value] : value.filter((v) => v !== o.value))} />
              <span>{o.label}</span>
            </label>
          ))}
          {value.length > 0 && <button type="button" className="btn ghost small" style={{ width: '100%', marginTop: 4 }} onClick={() => onChange([])}>Clear</button>}
        </div>
      )}
    </div>
  );
}
