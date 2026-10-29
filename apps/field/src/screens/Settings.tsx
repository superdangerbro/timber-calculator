import { useMemo, useState } from 'react';
import { toCsv, toGeoJson, toKml } from '@timber/core';
import { useApp } from '../app';
import { useEmitter } from '../lib/emitter';
import { Icon } from '../components/Icon';
import { shareFile } from '../lib/exporter';
import { isToday } from '../state/repo';
import type { Settings } from '../state/settings';

function Row({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="set-row">
      <div className="set-label">
        {label}
        {hint && <small>{hint}</small>}
      </div>
      <div className="set-control">{children}</div>
    </div>
  );
}

function Toggle({ on, onChange, testId }: { on: boolean; onChange: (v: boolean) => void; testId?: string }) {
  return (
    <button className={on ? 'toggle on' : 'toggle'} role="switch" aria-checked={on} onClick={() => onChange(!on)} data-testid={testId}>
      <span />
    </button>
  );
}

export function SettingsScreen() {
  const app = useApp();
  const { repo, sync, platform, tally } = app;
  const r = useEmitter(repo);
  const s = useEmitter(sync);
  const st = r.settings;
  const [email, setEmail] = useState(st.user?.email ?? '');
  const [password, setPassword] = useState('');
  const [server, setServer] = useState(st.serverUrl);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<'today' | 'all'>('all');

  const save = (patch: Partial<Settings>) => repo.saveSettings(patch);
  const next = useMemo(() => {
    try {
      return repo.peekTag(false).tag;
    } catch {
      return '?';
    }
  }, [r.trees, st.tagPrefix, st.blockCode, st.user]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportAs = async (fmt: 'csv' | 'geojson' | 'kml') => {
    const trees = r.trees.filter((t) => !t.voided && (scope === 'all' || isToday(t.createdAt)));
    const stamp = new Date().toISOString().slice(0, 10);
    const name = `timber-${st.tagPrefix}-${stamp}.${fmt}`;
    try {
      if (fmt === 'csv') setMsg(await shareFile(name, 'text/csv', toCsv(trees, repo.scenario)));
      else if (fmt === 'geojson')
        setMsg(await shareFile(name, 'application/geo+json', JSON.stringify(toGeoJson(trees, repo.scenario), null, 2)));
      else {
        const block = r.blocks.find((b) => b.id === st.activeBlockId);
        setMsg(
          await shareFile(
            name,
            'application/vnd.google-earth.kml+xml',
            toKml(trees, { name: `Timber ${stamp}`, boundary: block?.boundary.type === 'Polygon' ? block.boundary : undefined }),
          ),
        );
      }
    } catch (e) {
      setMsg(`Export failed: ${(e as Error).message}`);
    }
  };

  return (
    <div className="page settings" data-testid="settings-screen">
      <header className="page-head">
        <h1>Settings</h1>
      </header>

      <section className="set-section">
        <h2>Account</h2>
        {st.token ? (
          <>
            <Row label="Signed in as">
              <b>{st.user?.name || st.user?.email}</b>
            </Row>
            <Row label="Server">
              <span className="mono small">{st.serverUrl}</span>
            </Row>
            <button className="btn ghost wide" onClick={() => void sync.signOut()}>
              Sign out
            </button>
          </>
        ) : (
          <form
            className="signin"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setMsg(null);
              try {
                const u = await sync.signIn(server.trim(), email.trim(), password);
                setMsg(`Signed in as ${u.name || u.email}. Prefix ${u.tagPrefix}.`);
                setPassword('');
                void sync.sync();
              } catch (err) {
                setMsg((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <input value={server} onChange={(e) => setServer(e.target.value)} placeholder="Server URL" inputMode="url" autoCapitalize="off" />
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" autoCapitalize="off" />
            <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" type="password" />
            <button className="btn primary wide" disabled={busy || !email || !password}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <p className="hint">Not signed in? Everything still works offline and syncs later.</p>
          </form>
        )}
      </section>

      <section className="set-section">
        <h2>Tagging</h2>
        <Row label="Your name">
          <input className="set-input" value={st.userName} onChange={(e) => void save({ userName: e.target.value })} />
        </Row>
        <Row label="Tag prefix" hint={st.user ? 'set by your account' : 'unique per person'}>
          <input
            className="set-input short"
            value={st.user?.tagPrefix ?? st.tagPrefix}
            disabled={!!st.user}
            maxLength={3}
            onChange={(e) => void save({ tagPrefix: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })}
            data-testid="prefix"
          />
        </Row>
        <Row label="Block code" hint="optional, e.g. CB12">
          <input
            className="set-input short"
            value={st.blockCode}
            maxLength={8}
            placeholder="none"
            onChange={(e) => void save({ blockCode: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
          />
        </Row>
        <Row label="Next tag">
          <b className="next-tag" data-testid="next-tag">
            {next}
          </b>
        </Row>
      </section>

      <section className="set-section">
        <h2>Measuring</h2>
        <Row label="I tape" hint="what a bare number means when you talk">
          <div className="seg">
            {(['circumference', 'dbh'] as const).map((m) => (
              <button key={m} className={st.measure === m ? 'on' : ''} onClick={() => void save({ measure: m })} data-testid={`measure-${m}`}>
                {m === 'circumference' ? 'Circumference' : 'Diameter'}
              </button>
            ))}
          </div>
        </Row>
        <Row label="Units" hint="for talking and the screen; stored metric">
          <div className="seg">
            {(['imperial', 'metric'] as const).map((u) => (
              <button key={u} className={st.units === u ? 'on' : ''} onClick={() => void save({ units: u })} data-testid={`units-${u}`}>
                {u === 'imperial' ? 'in / ft' : 'cm / m'}
              </button>
            ))}
          </div>
        </Row>
        <p className="hint">
          {st.measure === 'circumference'
            ? `Say "circ ${st.units === 'imperial' ? 'seventy five' : 'one ninety'}" or just the number; DBH is worked out (C ÷ π). "DBH 24" still works.`
            : `Say "${st.units === 'imperial' ? 'twenty four' : 'sixty'}" or "DBH ..."; "circumference ..." also works.`}
        </p>
      </section>

      <section className="set-section">
        <h2>Voice</h2>
        <Row label="Read back" hint="speak what was heard + what's missing">
          <Toggle on={st.readback} onChange={(v) => void save({ readback: v })} />
        </Row>
        <Row label={`Speech rate ${st.ttsRate.toFixed(1)}×`}>
          <input type="range" min={0.6} max={1.6} step={0.1} value={st.ttsRate} onChange={(e) => void save({ ttsRate: parseFloat(e.target.value) })} />
        </Row>
        <Row label="Recogniser">
          <span className="small">
            {platform.speech.kind === 'native' ? 'iPhone on-device' : platform.speech.kind === 'web' ? 'Browser speech' : 'Typed (no mic)'}
            {platform.interpreter.available ? ' + Apple Intelligence' : ''}
          </span>
        </Row>
        <button className="btn ghost wide" onClick={() => void platform.tts.speak('Tag J, zero one four seven.', { rate: st.ttsRate })}>
          <Icon name="speaker" size={20} /> Test voice
        </button>
      </section>

      <section className="set-section">
        <h2>GPS</h2>
        <Row label="Simulated GPS" hint="desktop testing near CB12">
          <Toggle
            on={st.simulatedGps}
            testId="sim-gps"
            onChange={async (v) => {
              await save({ simulatedGps: v });
              await app.applyGpsSetting();
            }}
          />
        </Row>
      </section>

      <section className="set-section">
        <h2>Sync</h2>
        <Row label="Status">
          <span data-testid="sync-status">
            {st.token ? s.status : 'not signed in'} · {r.unsyncedCount} unsynced
          </span>
        </Row>
        {s.lastSyncAt && (
          <Row label="Last sync">
            <span className="small">
              {new Date(s.lastSyncAt).toLocaleTimeString()} · ↑{s.lastPushed} ↓{s.lastPulled}
            </span>
          </Row>
        )}
        {s.lastError && <div className="error-card small">{s.lastError}</div>}
        <Row label="Auto-sync every 60 s">
          <Toggle on={st.autoSync} onChange={(v) => void save({ autoSync: v })} />
        </Row>
        <button className="btn primary wide" disabled={!st.token || s.status === 'syncing'} onClick={() => void sync.sync()} data-testid="sync-now">
          <Icon name="sync" size={20} /> Sync now
        </button>
      </section>

      <section className="set-section">
        <h2>Export</h2>
        <div className="seg wide">
          {(['today', 'all'] as const).map((w) => (
            <button key={w} className={scope === w ? 'on' : ''} onClick={() => setScope(w)}>
              {w === 'today' ? "Today's trees" : 'All trees'}
            </button>
          ))}
        </div>
        <div className="export-row">
          <button className="btn ghost" onClick={() => void exportAs('csv')} data-testid="export-csv">
            CSV
          </button>
          <button className="btn ghost" onClick={() => void exportAs('geojson')} data-testid="export-geojson">
            GeoJSON
          </button>
          <button className="btn ghost" onClick={() => void exportAs('kml')} data-testid="export-kml">
            KML
          </button>
        </div>
      </section>

      {msg && (
        <div className="toast" data-testid="settings-msg" onClick={() => setMsg(null)}>
          {msg}
        </div>
      )}

      <section className="set-section about">
        <div className="small mono">Device {st.deviceId.slice(0, 8)} · {r.events.length} events</div>
        <button
          className="btn ghost wide"
          onClick={() => {
            void tally.shutdown();
          }}
        >
          Stop listening
        </button>
      </section>
    </div>
  );
}
