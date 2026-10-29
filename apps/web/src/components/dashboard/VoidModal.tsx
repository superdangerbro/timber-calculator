'use client';
import { useState } from 'react';
import type { Tree } from '@timber/core';
import { Modal } from '../ui/Modal';

export function VoidModal({ tree, onClose, onConfirm }: { tree: Tree; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <Modal title={<>Void <span className="tag">{tree.tag}</span>?</>} onClose={onClose} width={460}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" data-testid="confirm-void" onClick={() => onConfirm(reason.trim())}>Void tree</button>
      </>}>
      <p className="muted" style={{ marginTop: 0 }}>The tree stays in the record as a <b>void</b> event (nothing is deleted) and is excluded from totals. Its tag number is never reused.</p>
      <label className="label" htmlFor="void-reason">Reason</label>
      <input id="void-reason" className="input" style={{ width: '100%' }} autoFocus value={reason} onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. duplicate tag, outside block" onKeyDown={(e) => { if (e.key === 'Enter') onConfirm(reason.trim()); }} />
      <div className="quick-reasons">
        {['Duplicate tag', 'Outside block', 'Wrong tree flagged', 'Blown down'].map((r) => (
          <button key={r} type="button" className="chip" onClick={() => setReason(r)}>{r}</button>
        ))}
      </div>
    </Modal>
  );
}
