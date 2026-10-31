'use client';
import { useEffect, useState } from 'react';
import { hasPrices, tierLabel, BEC_ZONES, DEFAULT_BEC_ZONE, DEFAULT_TOP_DIB_CM, SPECIES, SPECIES_COLORS, type AreaSummary, type Scale, type Scenario, type SpeciesCode } from '@timber/core';
import { money, signed } from '@/lib/format';

/** Set or clear one $/m³ entry (an empty box means "not set", not $0). */
function setPrice<K extends string>(map: Partial<Record<K, number>>, key: K, raw: string): Record<K, number> {
  const next = { ...map } as Record<K, number>;
  if (raw.trim() === '') delete next[key];
  else next[key] = Math.max(0, Number(raw));
  return next;
}

/** Cut lengths as "108 103 98" text; parsed on blur. */
function LengthsInput({ value, onChange, label }: { value: number[]; onChange: (v: number[]) => void; label: string }) {
  const [text, setText] = useState(value.join(' '));
  useEffect(() => setText(value.join(' ')), [value]);
  return (
    <input className="input" value={text} aria-label={label} onChange={(e) => setText(e.target.value)}
      onBlur={() => onChange(text.split(/[^0-9.]+/).filter(Boolean).map(Number).filter((x) => x > 0).sort((a, b) => b - a))} />
  );
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
  const tiers = scenario.poleLengthTiers ?? [];
  const setTier = (i: number, patch: Partial<(typeof tiers)[number]>) =>
    onChange({ ...scenario, poleLengthTiers: tiers.map((t, j) => (j === i ? { ...t, ...patch } : t)) });

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
        <details className="pgroup" open data-testid="pole-tiers">
          <summary>Pole $/m³ by length <span className="muted">(gross volume)</span></summary>
          <p className="muted small">Cedar: the pole card below sets the length. Other species: marketable height rounded down to 5 ft. Trees that pass the pole spec but are shorter than every band are valued as sawlog.</p>
          <table className="ptable tiers">
            <thead><tr><th>From ft</th><th>To ft</th><th>$/m³</th><th /></tr></thead>
            <tbody>
              {tiers.map((t, i) => (
                <tr key={i} data-testid={`tier-${i}`}>
                  <td><input className="input" type="number" min={0} step={5} value={t.minFt} aria-label={`Band ${i + 1} from feet`} data-testid={`tier-min-${i}`}
                    onChange={(e) => setTier(i, { minFt: n(e.target.value) })} /></td>
                  <td><input className="input" type="number" min={0} step={5} value={t.maxFt ?? ''} placeholder="+" aria-label={`Band ${i + 1} to feet (blank = and up)`} data-testid={`tier-max-${i}`}
                    onChange={(e) => setTier(i, { maxFt: e.target.value === '' ? null : n(e.target.value) })} /></td>
                  <td><input className="input" type="number" min={0} value={t.pricePerM3 || ''} placeholder="$/m³" aria-label={`Band ${i + 1} price per cubic metre`} data-testid={`tier-price-${i}`}
                    onChange={(e) => setTier(i, { pricePerM3: n(e.target.value) })} /></td>
                  <td><button type="button" className="btn ghost small" aria-label={`Remove band ${tierLabel(t)}`} title="Remove band"
                    onClick={() => onChange({ ...scenario, poleLengthTiers: tiers.filter((_, j) => j !== i) })}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="btn small" data-testid="tier-add"
            onClick={() => onChange({ ...scenario, poleLengthTiers: [...tiers, { minFt: tiers.length ? (tiers[tiers.length - 1].maxFt ?? tiers[tiers.length - 1].minFt) + 5 : 35, maxFt: null, pricePerM3: 0 }] })}>+ Add band</button>
        </details>

        <details className="pgroup" open={tiers.length === 0}>
          <summary>Pole $/m³ by class <span className="muted">{tiers.length ? '(not used while length bands are set)' : '(gross volume)'}</span></summary>
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

        {(spec.cards ?? []).map((card, ci) => {
          const setCard = (patch: Partial<typeof card>) =>
            setSpec({ cards: (spec.cards ?? []).map((c, j) => (j === ci ? { ...c, ...patch } : c)) });
          const setRow = (ri: number, patch: Partial<(typeof card.rows)[number]>) =>
            setCard({ rows: card.rows.map((r, j) => (j === ri ? { ...r, ...patch } : r)) });
          return (
            <details key={ci} className="pgroup" data-testid={`pole-card-${ci}`}>
              <summary>Pole card: {card.name} <span className="muted">({card.species.join(', ')})</span></summary>
              <p className="muted small">From each tree's DBH and marketable height the BC taper equation estimates the diameter 6 ft above the butt (over bark). The tree uses the last row it meets and makes the longest length whose top is at least the minimum top. Sold length = cut length − trim, which picks the $/m³ band.</p>
              <label className="row between deduct">
                <span>Trim allowance</span>
                <span className="row"><input className="input" type="number" min={0} max={20} value={card.trimFt} data-testid="card-trim"
                  onChange={(e) => setCard({ trimFt: n(e.target.value) })} aria-label="Trim allowance feet" />&nbsp;ft</span>
              </label>
              <table className="ptable card-table">
                <thead><tr><th>6 ft dia ≥ in</th><th>Cut lengths ft</th><th>Min top in</th></tr></thead>
                <tbody>
                  {card.rows.map((r, ri) => (
                    <tr key={ri} data-testid={`card-row-${ri}`}>
                      <td><input className="input" type="number" min={0} value={r.minDiam6FtIn} aria-label={`Row ${ri + 1} minimum diameter at 6 ft`}
                        onChange={(e) => setRow(ri, { minDiam6FtIn: n(e.target.value) })} /></td>
                      <td><LengthsInput value={r.lengthsFt} onChange={(lengthsFt) => setRow(ri, { lengthsFt })} label={`Row ${ri + 1} cut lengths`} /></td>
                      <td><input className="input" type="number" min={0} value={r.minTopIn} aria-label={`Row ${ri + 1} minimum top`}
                        onChange={(e) => setRow(ri, { minTopIn: n(e.target.value) })} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted small">Faults that knock a tree out of pole grade are ticked per tree on the phone: damage over 1", splits/cracks, butt or top rot, bark seams over 2", spike knots/burls, shake in the outer 2", excess sweep.</p>
            </details>
          );
        })}

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
            <label>Min length m<input className="input" type="number" min={0} step={0.01} value={spec.minLengthM} onChange={(e) => setSpec({ minLengthM: n(e.target.value) })} /></label>
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
