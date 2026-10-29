'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_SCENARIO, SPECIES_COLORS, polygonAreaHa, speciesName, summarize, treesInArea, valueTree,
  type Block, type Scenario, type SpeciesCode, type Tree, type UserProfile,
} from '@timber/core';
import { LogoMark } from '../Logo';
import { bboxOf } from '@/lib/boundary';
import { activeFilterCount, DEFAULT_FILTERS, passesFilters, type Filters } from '@/lib/filters';
import { money, num } from '@/lib/format';
import { loadPref, REPORT_KEY, type ReportState } from '@/lib/prefs';

type Geom = GeoJSON.Polygon | GeoJSON.MultiPolygon;

function describeFilters(f: Filters, users: UserProfile[]): string[] {
  const out: string[] = [];
  if (f.species.length) out.push(`Species: ${f.species.join(', ')}`);
  if (f.dbhMin !== null || f.dbhMax !== null) out.push(`DBH ${f.dbhMin ?? 0}–${f.dbhMax ?? '∞'} cm`);
  if (f.heightMin !== null || f.heightMax !== null) out.push(`Height ${f.heightMin ?? 0}–${f.heightMax ?? '∞'} m`);
  if (f.minStraightness > 1) out.push(`Straightness ≥ ${f.minStraightness}`);
  if (f.minTwist > 1) out.push(`Twist ≥ ${f.minTwist}`);
  if (f.minBranchiness > 1) out.push(`Branchiness ≥ ${f.minBranchiness}`);
  if (f.product !== 'all') out.push(`Product: ${f.product}`);
  if (f.poleClass) out.push(f.poleClass);
  if (f.leave !== 'all') out.push(f.leave === 'only' ? 'Leave trees only' : 'Excluding leave trees');
  if (f.status.length) out.push(`Status: ${f.status.join(', ')}`);
  if (f.markedBy.length) out.push(`Marked by: ${f.markedBy.map((id) => users.find((u) => u.id === id)?.tagPrefix ?? '?').join(', ')}`);
  if (f.dateFrom || f.dateTo) out.push(`Dates ${f.dateFrom || '…'} to ${f.dateTo || '…'}`);
  if (f.includeVoided) out.push('Including voided');
  return out;
}

function MiniMap({ area, trees, product }: { area: Geom | null; trees: Tree[]; product: (t: Tree) => 'pole' | 'sawlog' | 'none' }) {
  const W = 520, H = 360, pad = 16;
  const pts = trees.map((t) => [t.lon, t.lat]);
  let [w, s, e, n] = area ? bboxOf(area) : [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
  if (!Number.isFinite(w)) [w, s, e, n] = [-120.36, 50.69, -120.34, 50.71];
  const k = Math.cos(((s + n) / 2) * Math.PI / 180);
  const scale = Math.min((W - 2 * pad) / ((e - w) * k || 1e-6), (H - 2 * pad) / ((n - s) || 1e-6));
  const ox = (W - (e - w) * k * scale) / 2; const oy = (H - (n - s) * scale) / 2;
  const X = (lon: number) => ox + (lon - w) * k * scale; const Y = (lat: number) => oy + (n - lat) * scale;
  const rings = area ? (area.type === 'Polygon' ? [area.coordinates[0]] : area.coordinates.map((p) => p[0])) : [];
  const metres = 100; const barPx = metres / 111_320 * scale;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="rep-map" role="img" aria-label="Map of trees in area">
      <rect width={W} height={H} fill="#f4f7f4" />
      {rings.map((r, i) => <path key={i} d={'M' + r.map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join('L') + 'Z'} fill="#e3efe6" stroke="#1b4332" strokeWidth={2} />)}
      {trees.map((t) => <circle key={t.id} cx={X(t.lon)} cy={Y(t.lat)} r={Math.max(2.5, Math.min(6, (t.dbhCm ?? 30) / 9))} fill={product(t) === 'pole' ? '#d97706' : product(t) === 'sawlog' ? '#0284c7' : '#9ca3af'} stroke="#fff" strokeWidth={0.8} />)}
      <g transform={`translate(${pad},${H - pad})`}>
        <rect x={0} y={-6} width={barPx} height={4} fill="#1b4332" /><text x={barPx + 6} y={-1} fontSize={11} fill="#1b4332">{metres} m</text>
      </g>
      <g transform={`translate(${W - pad - 12},${pad + 14})`}><text fontSize={13} fontWeight={700} fill="#1b4332" textAnchor="middle">N</text><path d="M0,4 L-5,16 L0,13 L5,16Z" fill="#1b4332" /></g>
    </svg>
  );
}

export function Report({ me }: { me: { name: string } }) {
  const [data, setData] = useState<{ trees: Tree[]; users: UserProfile[]; state: ReportState } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const get = async <T,>(u: string) => { const r = await fetch(u); if (!r.ok) throw new Error(`Failed to load ${u}`); return r.json() as Promise<T>; };
        const [t, u] = await Promise.all([get<{ trees: Tree[] }>('/api/trees'), get<{ users: UserProfile[] }>('/api/users')]);
        let state = loadPref<ReportState | null>(REPORT_KEY, null);
        const blockId = new URLSearchParams(location.search).get('block');
        if (blockId || !state) {
          const [b, s] = await Promise.all([get<{ blocks: Block[] }>('/api/blocks'), get<{ scenarios: Scenario[] }>('/api/scenarios')]);
          const block = b.blocks.find((x) => x.id === blockId) ?? b.blocks[0];
          const sc = s.scenarios[0] ?? DEFAULT_SCENARIO;
          state = {
            filters: DEFAULT_FILTERS, area: block ? { kind: 'block', name: block.code ?? block.name, geometry: block.boundary, blockId: block.id } : null,
            scenario: sc, scenarioName: sc.name, dirty: false, createdAt: new Date().toISOString(), by: me.name,
          };
        }
        setData({ trees: t.trees, users: u.users, state });
      } catch (e) { setErr((e as Error).message); }
    })();
  }, [me.name]);

  const calc = useMemo(() => {
    if (!data) return null;
    const { state } = data;
    const sc = state.scenario;
    const vals = new Map(data.trees.map((t) => [t.id, valueTree(t, sc)]));
    let list = data.trees.filter((t) => passesFilters(t, vals.get(t.id), state.filters));
    if (state.area) list = treesInArea(list, state.area.geometry);
    list.sort((a, b) => a.prefix.localeCompare(b.prefix) || (a.leaveTree ? 1 : 0) - (b.leaveTree ? 1 : 0) || a.tagNumber - b.tagNumber);
    const summary = summarize(list, sc);
    const areaHa = state.area ? polygonAreaHa(state.area.geometry) : null;
    const bySpecies = new Map<string, { n: number; dbh: number; ht: number; vol: number; value: number; saw: number; sawValue: number; poles: number }>();
    for (const t of list) {
      if (t.voided) continue;
      const v = vals.get(t.id)!; const k = t.species ?? '?';
      const r = bySpecies.get(k) ?? { n: 0, dbh: 0, ht: 0, vol: 0, value: 0, saw: 0, sawValue: 0, poles: 0 };
      r.n++; r.dbh += t.dbhCm ?? 0; r.ht += t.heightM ?? 0; r.vol += v.volumeM3; r.value += v.value;
      if (v.product === 'sawlog') { r.saw += v.volumeM3; r.sawValue += v.value; }
      if (v.product === 'pole') r.poles++;
      bySpecies.set(k, r);
    }
    const poleRows = sc.poleSpec.classes.map((c) => {
      const ts = list.filter((t) => vals.get(t.id)?.product === 'pole' && vals.get(t.id)?.poleClass === c.name);
      return { name: c.name, n: ts.length, value: ts.reduce((a, t) => a + vals.get(t.id)!.value, 0), len: ts.reduce((a, t) => a + (t.heightM ?? 0), 0) };
    });
    return { list, vals, summary, areaHa, bySpecies: [...bySpecies.entries()].sort((a, b) => b[1].n - a[1].n), poleRows };
  }, [data]);

  if (err) return <div className="report"><p>{err}</p></div>;
  if (!data || !calc) return <div className="report"><p>Preparing report…</p></div>;
  const { state, users } = data; const { summary, areaHa, list, vals } = calc;
  const fdesc = describeFilters(state.filters, users);

  return (
    <div className="report" data-testid="report">
      <div className="rep-actions no-print">
        <button className="btn primary" onClick={() => window.print()}>Print / save as PDF</button>
        <a className="btn" href="/">Back to dashboard</a>
      </div>
      <header className="rep-head">
        <div className="rep-brand"><LogoMark size={36} /><div><b>Timber Calculator</b><span>Cruise summary</span></div></div>
        <div className="rep-meta">
          <h1>{state.area?.name ?? 'All trees'}</h1>
          <div>{areaHa !== null ? `${num(areaHa, 1)} ha · ` : ''}Pricing: <b>{state.scenarioName}{state.dirty ? ' (unsaved edits)' : ''}</b></div>
          <div>Prepared {new Date(state.createdAt).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })} by {state.by}</div>
        </div>
      </header>

      <section className="rep-kpis">
        <div><span>Trees</span><b data-testid="report-trees">{summary.treeCount}</b><small>{summary.leaveTreeCount} leave</small></div>
        <div><span>Poles</span><b>{summary.poleCount}</b><small>{money(summary.poleValue)}</small></div>
        <div><span>Sawlog volume</span><b>{num(Object.values(summary.sawlogM3BySpecies).reduce((a, b) => a + (b ?? 0), 0), 1)} m³</b><small>{money(summary.sawlogValue)}</small></div>
        <div><span>Total volume</span><b>{num(summary.totalVolumeM3, 1)} m³</b><small>{areaHa ? `${num(summary.totalVolumeM3 / areaHa, 1)} m³/ha` : ''}</small></div>
        <div className="hl"><span>Total value</span><b>{money(summary.totalValue)}</b><small>{areaHa ? `${money(summary.totalValue / areaHa)}/ha` : ''}</small></div>
      </section>

      <section className="rep-two">
        <div>
          <h2>Map</h2>
          <MiniMap area={state.area?.geometry ?? null} trees={list.filter((t) => !t.voided)} product={(t) => vals.get(t.id)?.product ?? 'none'} />
          <div className="rep-legend"><span><i style={{ background: '#d97706' }} />Pole</span><span><i style={{ background: '#0284c7' }} />Sawlog</span><span><i style={{ background: '#9ca3af' }} />Leave / none</span><span className="muted">Dot size ∝ DBH</span></div>
        </div>
        <div>
          <h2>Poles by class</h2>
          <table className="rep-table">
            <thead><tr><th>Class</th><th>Spec</th><th className="r">Pieces</th><th className="r">Avg len m</th><th className="r">Value</th></tr></thead>
            <tbody>
              {calc.poleRows.map((r, i) => { const c = state.scenario.poleSpec.classes[i]; return (
                <tr key={r.name}><td>{r.name}</td><td className="muted">≥{c.minDbhCm} cm, ≥{c.minLengthM} m</td><td className="r">{r.n}</td><td className="r">{r.n ? num(r.len / r.n, 1) : '—'}</td><td className="r">{money(r.value)}</td></tr>
              ); })}
              <tr className="tot"><td colSpan={2}>Total</td><td className="r">{summary.poleCount}</td><td /><td className="r">{money(summary.poleValue)}</td></tr>
            </tbody>
          </table>
          <h2>By species</h2>
          <table className="rep-table">
            <thead><tr><th>Species</th><th className="r">Trees</th><th className="r">Avg DBH</th><th className="r">Avg ht</th><th className="r">Poles</th><th className="r">Sawlog m³</th><th className="r">Value</th></tr></thead>
            <tbody>
              {calc.bySpecies.map(([sp, r]) => (
                <tr key={sp}><td><i className="sw" style={{ background: SPECIES_COLORS[sp as SpeciesCode] ?? '#999' }} />{sp} <span className="muted">{speciesName(sp)}</span></td>
                  <td className="r">{r.n}</td><td className="r">{num(r.dbh / r.n, 0)}</td><td className="r">{num(r.ht / r.n, 1)}</td><td className="r">{r.poles}</td><td className="r">{num(r.saw, 1)}</td><td className="r">{money(r.value)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>Pricing &amp; filters</h2>
        <p className="rep-small">
          Sawlog $/m³: {Object.entries(state.scenario.sawlogPricePerM3).map(([k, v]) => `${k} ${v}`).join(' · ')}.{' '}
          Poles: {state.scenario.poleSpec.classes.map((c) => { const p = state.scenario.polePrices[c.name]; return p ? `${c.name} $${p.perPiece} + $${p.perMetre}/m` : c.name; }).join(' · ')}.{' '}
          Pole spec: {state.scenario.poleSpec.species.join('/')} ≥ {state.scenario.poleSpec.minLengthM} m, straightness ≥ {state.scenario.poleSpec.minStraightness}, twist ≥ {state.scenario.poleSpec.minTwist}, branchiness ≥ {state.scenario.poleSpec.minBranchiness}. Defect deduction {Math.round(state.scenario.defectDeduction * 100)}%. Volume: BC Kozak taper equations, {state.scenario.becZone ?? 'ICH'} zone, to a {state.scenario.topDibCm ?? 15} cm top.
        </p>
        <p className="rep-small">Filters: {activeFilterCount(state.filters) ? fdesc.join(' · ') : 'none (all live trees)'}. Volumes use placeholder Schumacher-Hall coefficients pending BC taper equations.</p>
      </section>

      <section className="rep-break">
        <h2>Tree list ({list.length})</h2>
        <table className="rep-table dense">
          <thead><tr><th>Tag</th><th>Sp</th><th className="r">DBH</th><th className="r">Ht</th><th className="r">S/T/B</th><th>Product</th><th className="r">Vol m³</th><th className="r">Value</th><th>Status</th><th>By</th></tr></thead>
          <tbody>
            {list.map((t) => { const v = vals.get(t.id)!; return (
              <tr key={t.id} className={t.voided ? 'void' : ''}>
                <td className="mono b">{t.tag}</td><td>{t.species ?? '—'}</td><td className="r">{num(t.dbhCm, 0)}</td><td className="r">{num(t.heightM, 1)}</td>
                <td className="r">{t.straightness ?? '–'}/{t.twist ?? '–'}/{t.branchiness ?? '–'}</td>
                <td>{t.leaveTree ? 'Leave' : t.voided ? 'Void' : v.product === 'pole' ? `Pole ${v.poleClass?.replace('Class ', 'C')}` : v.product === 'sawlog' ? 'Sawlog' : '—'}</td>
                <td className="r">{num(v.volumeM3, 2)}</td><td className="r">{money(v.value)}</td><td>{t.status}</td><td>{t.prefix}</td>
              </tr>
            ); })}
          </tbody>
        </table>
      </section>
      <footer className="rep-foot">Generated by Timber Calculator · all measurements from hash-chained field events</footer>
    </div>
  );
}
