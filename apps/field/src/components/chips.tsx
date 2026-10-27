import { useApp } from '../app';
import { useEmitter } from '../lib/emitter';
import { Icon } from './Icon';

export function GpsChip() {
  const { gps } = useApp();
  const s = useEmitter(gps);
  const acc = s.averaging && s.averaged ? s.averaged.accuracyM : s.last?.accuracyM;
  const tone = acc === undefined ? 'bad' : acc <= 5 ? 'good' : acc <= 10 ? 'ok' : 'bad';
  return (
    <div className={`chip gps ${tone}`} data-testid="gps-chip">
      <Icon name="gps" size={18} />
      {acc === undefined ? (
        <span>{s.error ? 'No GPS' : 'GPS…'}</span>
      ) : (
        <span>
          ±{acc.toFixed(1)} m{s.averaging ? ` · ${s.fixes.length} fix${s.fixes.length === 1 ? '' : 'es'}` : ''}
        </span>
      )}
      {s.engine === 'simulated' && <span className="chip-tag">SIM</span>}
    </div>
  );
}

export function SyncChip({ onClick }: { onClick?: () => void }) {
  const { sync, repo } = useApp();
  const s = useEmitter(sync);
  const r = useEmitter(repo);
  const signedIn = !!r.settings.token;
  let label: string;
  let tone = 'ok';
  if (!signedIn) {
    label = r.unsyncedCount ? `${r.unsyncedCount} local` : 'Local only';
    tone = 'muted';
  } else if (s.status === 'syncing') label = 'Syncing…';
  else if (s.status === 'offline') {
    label = r.unsyncedCount ? `Offline · ${r.unsyncedCount}` : 'Offline';
    tone = 'muted';
  } else if (s.status === 'error') {
    label = 'Sync error';
    tone = 'bad';
  } else if (r.unsyncedCount) {
    label = `${r.unsyncedCount} to sync`;
    tone = 'ok';
  } else {
    label = 'Synced';
    tone = 'good';
  }
  return (
    <button className={`chip sync ${tone}`} onClick={onClick ?? (() => void sync.sync())} data-testid="sync-chip">
      <Icon name={signedIn && s.status !== 'offline' ? 'sync' : 'cloudOff'} size={18} />
      <span>{label}</span>
    </button>
  );
}
