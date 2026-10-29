'use client';
import { hasPrices, BEC_ZONES, DEFAULT_BEC_ZONE, DEFAULT_TOP_DIB_CM, SPECIES, SPECIES_COLORS, type AreaSummary, type Scale, type Scenario, type SpeciesCode } from '@timber/core';
import { money, signed } from '@/lib/format';

/** Set or clear one $/m³ entry (an empty box means "not set", not $0). */
function setPrice<K extends string>(map: Partial<Record<K, number>>, key: K, raw: string): Record<K, number> {
  const next = { ...map } as Record<K, number>;
  if (raw.trim() === '') delete next[key];
  else next[key] = Math.max(0, Number(raw));
  return next;
}

export function PricingPanel({
  scenario, onChange, saved, activeId, onSelect, dirty, onSave, onSaveAs, onRevert, saving,
  compareId, onCompare, current, compare, onClose,
}: {
  scenario: Scenario; onChange: (s: Scenario) => void; saved: Scenario[]; activeId: string | null; onSelect: (id: string) => void;
  dirty: boolean; onSave: () => void; onSaveAs: () => void; onRevert: () => void; saving: boolean;
  compareId: string; onCompare: (id: string) => void; current: AreaSummary; compare: AreaSummary | null; onClose: () => void;
}) {
  const spec = scenario.poleSpec;
  const setSpec = (patch: Partial<Scenario['poleSpec']>) => onChange({ ...scenario, poleSpec: { ...spec, ...patch } });
  const n = (v: string) => (v === '' ? 0 : Math.max(0, Number(v)));
  const compareName = saved.find((s) => s.id === compareId)?.name;

  return (
    <aside className="pricing" data-testid="pricing-panel" aria-label="What-if pricing">
      <div className="pricing-head">
        <div>
          <h2>What-if pricing</h2>
          <p className="muted">Prices only change values, never measurements.</p>
        </div>
        <button className="btn ghost small" onClick={onClose} aria-label="Hide pricing panel" title="Hide panel">Hide ›</button>
      </div>

      <div className="pricing-body">
        <div className="pgroup">
          <label className="label" htmlFor="scenario-select">Scenario</label>
          <div className="row">
            <select id="scenario-select" className="select grow" value={activeId ?? ''} onChange={(e) => onSelect(e.target.value)} data-testid="scenario-select">
              {!activeId && <option value="">Unsaved scenario</option>}
              {saved.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          {dirty && <div className="dirty-note" data-testid="dirty-note">● Unsaved changes — totals already reflect them</div>}
          <div className="row gap">
            <button className="btn primary small grow" disabled={!dirty || !activeId || saving} onClick={onSave}>Save</button>
            <button className="btn small grow" disabled={saving} onClick={onSaveAs} data-testid="save-as">Save as…</button>
            <button className="btn ghost small" disabled={!dirty} onClick={onRevert}>Revert</button>
          </div>
        </div>

        <div className="pgroup compare">
          <label className="label" htmlFor="compare-select">Compare with</label>
          <select id="compare-select" className="select" value={compareId} onChange={(e) => onCompare(e.target.value)} data-testid="compare-select">
            <option value="">No comparison</option>
            {saved.map((s) => <option key={s.id} value={s.id}>{s.name}{s.id === activeId ? ' (saved version)' : ''}</option>)}
          </select>
          {compare && (
            <table className="delta-table" data-testid="compare-table">
              <thead><tr><th /><th>This</th><th title={compareName}>Other</th><th>Δ</th></tr></thead>
              <tbody>
                {([
                  ['Poles', current.poleCount, compare.poleCount, (x: number) => String(Math.round(x))],
                  ['Pole $', current.poleValue, compare.poleValue, (x: number) => money(x)],
                  ['Sawlog $', current.sawlogValue, compare.sawlogValue, (x: number) => money(x)],
                  ['Total $', current.totalValue, compare.totalValue, (x: number) => money(x)],
                ] as const).map(([k, a, b, f]) => (
                  <tr key={k} className={k === 'Total $' ? 'strong' : ''}>
                    <td>{k}</td><td>{f(a)}</td><td>{f(b)}</td>
                    <td className={a - b > 0.004 ? 'up' : a - b < -0.004 ? 'down' : ''}>{Math.abs(a - b) < 0.005 ? '—' : signed(a - b, f)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {!hasPrices(scenario) && (
          <p className="price-hint" data-testid="price-hint">Enter your $/m³ below. Until then the app shows volumes and pole/sawlog counts only.</p>
        )}
        <details className="pgroup" open>
          <summary>Pole $/m³ <span className="muted">(gross volume, by class)</span></summary>
          <div className="saw-grid">
            {spec.classes.map((c) => (
              <label key={c.name} className="saw-item" title={`${c.name}: DBH ≥ ${c.minDbhCm} cm, length ≥ ${c.minLengthM} m`}>
                <span className="code">{c.name.replace('Class ', 'C')}</span>
                <input className="input" type="number" min={0} placeholder="$/m³" value={scenario.polePricePerM3?.[c.name] ?? ''}
                  onChange={(e) => onChange({ ...scenario, polePricePerM3: setPrice(scenario.polePricePerM3 ?? {}, c.name, e.target.value) })}
                  aria-label={`${c.name} pole price per cubic metre`} data-testid={`pole-m3-${c.name}`} />
              </label>
            ))}
          </div>
        </details>

        <details className="pgroup" open>
          <summary>Sawlog $/m³ <span className="muted">(net volume, by species)</span></summary>
          <div className="saw-grid">
            {SPECIES.filter((s) => s.conifer || scenario.sawlogPricePerM3[s.code] !== undefined).map((s) => (
              <label key={s.code} className="saw-item" title={s.name}>
                <span className="dot" style={{ background: SPECIES_COLORS[s.code] }} /><span className="code">{s.code}</span>
                <input className="input" type="number" min={0} placeholder="$/m³" value={scenario.sawlogPricePerM3[s.code] ?? ''}
                  onChange={(e) => onChange({ ...scenario, sawlogPricePerM3: setPrice(scenario.sawlogPricePerM3, s.code, e.target.value) })}
                  aria-label={`${s.name} sawlog price per cubic metre`} data-testid={`saw-${s.code}`} />
              </label>
            ))}
          </div>
          <label className="row between deduct">
            <span>Defect deduction</span>
            <span className="row"><input className="input" type="number" min={0} max={100} value={Math.round(scenario.defectDeduction * 100)}
              onChange={(e) => onChange({ ...scenario, defectDeduction: Math.min(100, n(e.target.value)) / 100 })} aria-label="Defect deduction percent" />&nbsp;%</span>
          </label>
          <label className="row between deduct" title="BC Kozak taper equations by biogeoclimatic zone">
            <span>BEC zone</span>
            <select className="input" style={{ width: 96 }} value={scenario.becZone ?? DEFAULT_BEC_ZONE} data-testid="bec-zone"
              onChange={(e) => onChange({ ...scenario, becZone: e.target.value })} aria-label="BEC zone for volume equations">
              {BEC_ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </label>
          <label className="row between deduct" title="Inside-bark top diameter that marketable heights are called to">
            <span>Marketable top</span>
            <span className="row"><input className="input" type="number" min={5} max={60} value={scenario.topDibCm ?? DEFAULT_TOP_DIB_CM} data-testid="top-dib"
              onChange={(e) => onChange({ ...scenario, topDibCm: Math.min(60, Math.max(5, n(e.target.value))) })} aria-label="Marketable top diameter in centimetres" />&nbsp;cm</span>
          </label>
        </details>

        <details className="pgroup">
          <summary>Pole spec thresholds</summary>
          <div className="spec-species">
            {SPECIES.filter((s) => s.conifer).map((s) => {
              const on = spec.species.includes(s.code);
              return (
                <button key={s.code} type="button" className={`chip${on ? ' on' : ''}`} title={s.name}
                  onClick={() => setSpec({ species: on ? spec.species.filter((c) => c !== s.code) : [...spec.species, s.code as SpeciesCode] })}>
                  <span className="dot" style={{ background: SPECIES_COLORS[s.code] }} />{s.code}
                </button>
              );
            })}
          </div>
          <div className="spec-mins">
            <label>Min length m<input className="input" type="number" min={0} value={spec.minLengthM} onChange={(e) => setSpec({ minLengthM: n(e.target.value) })} /></label>
            {([['minStraightness', 'Straight ≥'], ['minTwist', 'Twist ≥'], ['minBranchiness', 'Branch ≥']] as const).map(([k, l]) => (
              <label key={k}>{l}
                <select className="select" value={spec[k]} onChange={(e) => setSpec({ [k]: Number(e.target.value) as Scale })} data-testid={`spec-${k}`}>
                  {[1, 2, 3, 4, 5].map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
            ))}
          </div>
          <table className="ptable">
            <thead><tr><th>Class</th><th>Min DBH cm</th><th>Min len m</th></tr></thead>
            <tbody>
              {spec.classes.map((c, i) => (
                <tr key={c.name}>
                  <td>{c.name}</td>
                  <td><input className="input" type="number" min={0} value={c.minDbhCm}
                    onChange={(e) => setSpec({ classes: spec.classes.map((x, j) => (j === i ? { ...x, minDbhCm: n(e.target.value) } : x)) })} /></td>
                  <td><input className="input" type="number" min={0} value={c.minLengthM}
                    onChange={(e) => setSpec({ classes: spec.classes.map((x, j) => (j === i ? { ...x, minLengthM: n(e.target.value) } : x)) })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">Placeholder spec until buyer specs are confirmed.</p>
        </details>
      </div>
    </aside>
  );
}
