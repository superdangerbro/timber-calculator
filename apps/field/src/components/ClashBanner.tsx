import { useState } from 'react';
import { useApp } from '../app';
import { useEmitter } from '../lib/emitter';
import { Icon } from './Icon';

/**
 * Warns when a tree tallied on this phone shares its tag with an earlier tree
 * (tallied before sign-in, or on another offline device) and re-tags it in one tap.
 */
export function ClashBanner({ showResult = false }: { showResult?: boolean }) {
  const { repo, tally } = useApp();
  const r = useEmitter(repo);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ from: string; to: string } | null>(null);
  const clash = r.clashes[0];

  if (done && showResult) {
    return (
      <div className="clash-banner done" data-testid="clash-done">
        <div className="clash-text">
          <b>{done.from}</b> re-tagged. Put new tape on it:
        </div>
        <div className="clash-newtag" data-testid="clash-newtag">{done.to}</div>
        <button className="btn ghost" onClick={() => setDone(null)}>
          Done
        </button>
      </div>
    );
  }
  if (!clash) return null;
  const next = repo.peekTag(/-L\d+$/.test(clash.tree.tag)).tag;
  const sameDevice = clash.holder.deviceId === clash.tree.deviceId;
  return (
    <div className="clash-banner" role="alert" data-testid="clash-banner">
      <Icon name="alert" size={26} />
      <div className="clash-text">
        <b>Tag clash: {clash.tree.tag}</b> is also used {sameDevice ? 'by an earlier tree' : 'on another device'}
        {r.clashes.length > 1 ? ` (${r.clashes.length} clashes)` : ''}.
        <span> Re-tag this tree as <b>{next}</b>.</span>
      </div>
      <button
        className="btn primary"
        disabled={busy}
        data-testid="clash-retag"
        onClick={async () => {
          setBusy(true);
          try {
            const from = clash.tree.tag;
            const id = clash.tree.id;
            await tally.retag(id);
            setDone({ from, to: repo.tree(id)?.tag ?? next });
          } finally {
            setBusy(false);
          }
        }}
      >
        Re-tag {next}
      </button>
    </div>
  );
}
