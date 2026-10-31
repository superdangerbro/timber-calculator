import { useState } from 'react';
import { DEFAULT_SCENARIO, POLE_BUYER_TIERS, SPECIES, tierLabel, type PoleLengthTier, type Scenario, type SpeciesCode } from '@timber/core';

/** A number box that lets you clear it while typing; empty = not set. */
function NumBox({ value, onChange, placeholder, label, testId }: {
  value: number | null | undefined; onChange: (v: number | null) => void; placeholder?: string; label: string; testId?: string;
}) {
  const [text, setText] = useState(value === null || value === undefined || value === 0 ? '' : String(value));
  return (
    <input
      className="set-input price-box"
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      aria-label={label}
      data-testid={testId}
      onChange={(e) => {
        const t = e.target.value.replace(/[^0-9.]/g, '');
        setText(t);
        onChange(t === '' ? null : Math.max(0, Number(t)));
      }}
    />
  );
}

const POLE_SAW_SPECIES: SpeciesCode[] = ['CW', 'FD', 'LW', 'PL', 'SX', 'HW', 'BL', 'PY'];

/**
 * Phone pricing: pole $/m³ by pole length (seeded with the pole buyer's prices) and
 * sawlog $/m³ by species. Saved on the phone, works with no signal.
 */
export function PriceSettings({ scenario, onSave }: { scenario: Scenario; onSave: (s: Scenario) => void }) {
  const tiers = scenario.poleLengthTiers ?? [];
  // Bump a key so the boxes re-read values after a reset.
  const [gen, setGen] = useState(0);
  const put = (patch: Partial<Scenario>) => onSave({ ...scenario, ...patch, updatedAt: new Date().toISOString() });
  const setTier = (i: number, patch: Partial<PoleLengthTier>) =>
    put({ poleLengthTiers: tiers.map((t, j) => (j === i ? { ...t, ...patch } : t)) });

  return (
    <div className="prices" key={gen} data-testid="price-settings">
      <h3>Pole $/m³ by length</h3>
      <p className="hint">
        Cedar: the Stella-Jones card sets the length (diameter 6 ft up the stem → longest pole it makes, sold as cut length − 3 ft).
        Other species: marketable height rounded down to 5 ft. A pole-grade tree shorter than every band is priced as sawlog.
      </p>
      <div className="tier-head"><span>From ft</span><span>To ft</span><span>$/m³</span><span /></div>
      {tiers.map((t, i) => (
        <div className="tier-row" key={i} data-testid={`tier-${i}`}>
          <NumBox value={t.minFt} label={`Band ${i + 1} from feet`} testId={`tier-min-${i}`} onChange={(v) => setTier(i, { minFt: v ?? 0 })} />
          <NumBox value={t.maxFt} placeholder="and up" label={`Band ${i + 1} to feet`} testId={`tier-max-${i}`} onChange={(v) => setTier(i, { maxFt: v })} />
          <NumBox value={t.pricePerM3} placeholder="$/m³" label={`Band ${i + 1} price per cubic metre`} testId={`tier-price-${i}`} onChange={(v) => setTier(i, { pricePerM3: v ?? 0 })} />
          <button className="tier-x" aria-label={`Remove ${tierLabel(t)} band`} onClick={() => { put({ poleLengthTiers: tiers.filter((_, j) => j !== i) }); setGen(gen + 1); }}>✕</button>
        </div>
      ))}
      <div className="tier-actions">
        <button className="chip" data-testid="tier-add" onClick={() => {
          const last = tiers[tiers.length - 1];
          put({ poleLengthTiers: [...tiers, { minFt: last ? (last.maxFt ?? last.minFt) + 5 : 35, maxFt: null, pricePerM3: 0 }] });
          setGen(gen + 1);
        }}>+ Add band</button>
        <button className="chip" data-testid="tier-reset" onClick={() => { put({ poleLengthTiers: POLE_BUYER_TIERS.map((t) => ({ ...t })) }); setGen(gen + 1); }}>Reset to buyer prices</button>
      </div>

      <h3>Sawlog $/m³</h3>
      <p className="hint">Net volume (after the {Math.round((scenario.defectDeduction ?? DEFAULT_SCENARIO.defectDeduction) * 100)}% defect deduction when defects are noted). Blank = not set.</p>
      <div className="saw-grid">
        {POLE_SAW_SPECIES.map((code) => (
          <label key={code} className="saw-cell">
            <span title={SPECIES.find((s) => s.code === code)?.name}>{code}</span>
            <NumBox value={scenario.sawlogPricePerM3?.[code]} placeholder="—" label={`${code} sawlog price per cubic metre`} testId={`saw-${code}`}
              onChange={(v) => {
                const next = { ...(scenario.sawlogPricePerM3 ?? {}) };
                if (v === null || v === 0) delete next[code];
                else next[code] = v;
                put({ sawlogPricePerM3: next });
              }} />
          </label>
        ))}
      </div>
    </div>
  );
}
