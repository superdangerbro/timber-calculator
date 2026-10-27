import { useEffect, useMemo, useRef, useState } from 'react';
import { tagSpeech, type TreeStatus } from '@timber/core';
import { useApp } from '../app';
import { useEmitter } from '../lib/emitter';
import { Icon } from '../components/Icon';
import { GpsChip } from '../components/chips';
import { SpeciesDot, speciesLabel } from '../components/fields';
import { TreeMap } from '../map/TreeMap';
import { bearingDeg, compassPoint, distanceM } from '../lib/geo';
import { usePressHandler } from '../Shell';

const STATUSES: { id: TreeStatus; label: string }[] = [
  { id: 'cut', label: 'Cut' },
  { id: 'standing', label: 'Standing' },
  { id: 'damaged', label: 'Damaged' },
  { id: 'missing', label: 'Missing' },
];

/** "cut", "standing", "damaged", "stump forty two" */
export function parseAudit(text: string): { status?: TreeStatus; stump?: number; next?: boolean } {
  const t = text.toLowerCase();
  const out: { status?: TreeStatus; stump?: number; next?: boolean } = {};
  if (/\b(cut|felled|down|harvested)\b/.test(t)) out.status = 'cut';
  else if (/\bdamaged?\b/.test(t)) out.status = 'damaged';
  else if (/\b(missing|gone|can't find)\b/.test(t)) out.status = 'missing';
  else if (/\b(standing|still up|uncut)\b/.test(t)) out.status = 'standing';
  if (/\bnext\b/.test(t)) out.next = true;
  const m = /stump\D*(\d+(?:\.\d+)?)/.exec(t);
  if (m) out.stump = parseFloat(m[1]);
  else {
    const words: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
    const units: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
    const w = /stump\s+(?:diameter\s+)?(\w+)(?:[\s-](\w+))?/.exec(t);
    if (w && words[w[1]]) out.stump = words[w[1]] + (w[2] && units[w[2]] ? units[w[2]] : 0);
  }
  return out;
}

export function AuditScreen() {
  const { repo, gps, platform } = useApp();
  const tts = platform.tts;
  const r = useEmitter(repo);
  const g = useEmitter(gps);
  const [selected, setSelected] = useState<string | null>(null);
  const [stump, setStump] = useState('');
  const [typed, setTyped] = useState('');
  const [heading, setHeading] = useState<number | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const here = g.last;

  useEffect(() => {
    let stop: (() => void) | null = null;
    let cancelled = false;
    platform.motion
      .start((o) => o.headingDeg != null && setHeading(o.headingDeg))
      .then((s) => (cancelled ? s() : (stop = s)))
      .catch(() => undefined);
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [platform]);

  const nearest = useMemo(() => {
    const live = r.trees.filter((t) => !t.voided && !(t.lat === 0 && t.lon === 0));
    return live
      .map((t) => ({
        t,
        d: here ? distanceM(here, t) : null,
        b: here ? bearingDeg(here, t) : null,
      }))
      .sort((a, b) => (a.d ?? 0) - (b.d ?? 0))
      .slice(0, 60);
  }, [r.trees, here?.lat, here?.lon]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selected && nearest[0]) setSelected(nearest[0].t.id);
  }, [nearest, selected]);

  const sel = nearest.find((x) => x.t.id === selected) ?? null;

  const apply = async (status: TreeStatus, stumpCm?: number) => {
    if (!sel) return;
    const s = stumpCm ?? (stump ? parseFloat(stump) : undefined);
    await repo.setStatus(sel.t.id, status, Number.isFinite(s as number) ? s : undefined);
    const msg = `${sel.t.tag} ${status}${s ? `, stump ${s} cm` : ''}`;
    setFlash(msg);
    setStump('');
    void tts.speak(`${tagSpeech(sel.t.tag).replace(/\.$/, '')}: ${status}.`);
  };

  const selectNext = () => {
    const i = nearest.findIndex((x) => x.t.id === selected);
    const n = nearest[(i + 1) % Math.max(1, nearest.length)];
    if (n) setSelected(n.t.id);
  };

  const handle = (text: string) => {
    const p = parseAudit(text);
    if (p.stump) setStump(String(p.stump));
    if (p.status) void apply(p.status, p.stump);
    if (p.next) selectNext();
  };
  const handleRef = useRef(handle);
  handleRef.current = handle;

  useEffect(() => {
    void platform.speech.start({ onFinal: (t) => handleRef.current(t) }, ['cut', 'standing', 'damaged', 'missing', 'stump', 'next']);
    return () => void platform.speech.stop();
  }, [platform]);

  usePressHandler(selectNext);

  const rel = sel?.b != null ? (heading != null ? sel.b - heading : sel.b) : null;

  return (
    <div className="page audit" data-testid="audit-screen">
      <div className="audit-map">
        <TreeMap
          trees={r.trees}
          blocks={r.blocks}
          position={here ? { lat: here.lat, lon: here.lon, accuracyM: here.accuracyM } : null}
          selectedId={selected}
          onSelect={setSelected}
        />
        <div className="map-chips">
          <GpsChip />
        </div>
      </div>

      {sel ? (
        <div className="audit-card" data-testid="audit-card">
          <div className="audit-target">
            <div className="audit-arrow" style={{ transform: `rotate(${rel ?? 0}deg)` }} aria-label="Bearing">
              <Icon name="arrow" size={40} stroke={3} />
            </div>
            <div className="audit-info">
              <div className="audit-tag" data-testid="audit-tag">
                {sel.t.tag}
              </div>
              <div className="audit-sub">
                <SpeciesDot code={sel.t.species} /> {speciesLabel(sel.t.species)} · {sel.t.dbhCm ?? '—'} cm
              </div>
              <div className="audit-dist">
                {sel.d == null ? 'no GPS' : `${sel.d < 1000 ? sel.d.toFixed(0) + ' m' : (sel.d / 1000).toFixed(2) + ' km'} ${compassPoint(sel.b ?? 0)}`}
                <span className={`badge st-${sel.t.status}`}>{sel.t.status}</span>
              </div>
            </div>
          </div>
          <div className="status-grid">
            {STATUSES.map((s) => (
              <button key={s.id} className={`status-btn ${s.id}${sel.t.status === s.id ? ' on' : ''}`} onClick={() => apply(s.id)} data-testid={`status-${s.id}`}>
                {s.label}
              </button>
            ))}
          </div>
          <div className="stump-row">
            <label>
              Stump Ø
              <input inputMode="decimal" value={stump} onChange={(e) => setStump(e.target.value)} placeholder="optional" data-testid="stump" />
              cm
            </label>
            <button className="btn ghost" onClick={selectNext} data-testid="audit-next">
              Next nearest
            </button>
          </div>
          <form
            className="type-row small"
            onSubmit={(e) => {
              e.preventDefault();
              if (typed.trim()) handle(typed.trim());
              setTyped('');
            }}
          >
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Say “cut, stump forty”" data-testid="audit-type" />
            <button type="submit" className="type-send" aria-label="Send">
              <Icon name="send" size={20} />
            </button>
          </form>
          {flash && <div className="flash" data-testid="audit-flash">{flash}</div>}
        </div>
      ) : (
        <div className="empty-card">No trees yet. Tally trees first.</div>
      )}

      <ul className="near-list" data-testid="near-list">
        {nearest.map(({ t, d, b }) => (
          <li key={t.id}>
            <button className={t.id === selected ? 'near-row on' : 'near-row'} onClick={() => setSelected(t.id)}>
              <span className="near-tag">{t.tag}</span>
              <SpeciesDot code={t.species} />
              <span className="near-sp">{t.species}</span>
              <span className={`badge st-${t.status}`}>{t.status}</span>
              <span className="near-d">
                {d == null ? '' : `${d.toFixed(0)} m`}
                {b != null && (
                  <span className="mini-arrow" style={{ transform: `rotate(${heading != null ? b - heading : b}deg)` }}>
                    ↑
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
