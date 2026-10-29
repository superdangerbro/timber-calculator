'use client';
import { SPECIES_COLORS, speciesName, type SpeciesCode, type TreeStatus, type UserProfile } from '@timber/core';
import { activeFilterCount, DEFAULT_FILTERS, type Filters } from '@/lib/filters';
import { MultiSelect } from '../ui/MultiSelect';

const STATUSES: TreeStatus[] = ['standing', 'cut', 'damaged', 'missing'];

export function FilterBar({ filters, onChange, speciesPresent, poleClasses, users }: {
  filters: Filters; onChange: (f: Filters) => void; speciesPresent: SpeciesCode[]; poleClasses: string[]; users: UserProfile[];
}) {
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => onChange({ ...filters, [k]: v });
  const numOrNull = (s: string) => (s.trim() === '' || Number.isNaN(Number(s)) ? null : Number(s));
  const active = activeFilterCount(filters);

  return (
    <div className="filterbar" data-testid="filterbar">
      <div className="fgroup species-chips" role="group" aria-label="Species">
        <span className="flabel">Species</span>
        {speciesPresent.map((c) => {
          const on = filters.species.includes(c);
          return (
            <button key={c} type="button" className={`chip${on ? ' on' : ''}`} title={speciesName(c)} data-testid={`species-${c}`}
              onClick={() => set('species', on ? filters.species.filter((x) => x !== c) : [...filters.species, c])}>
              <span className="dot" style={{ background: SPECIES_COLORS[c] }} />{c}
            </button>
          );
        })}
      </div>

      <div className="fgroup">
        <span className="flabel">DBH cm</span>
        <input className="input num" type="number" placeholder="min" value={filters.dbhMin ?? ''} onChange={(e) => set('dbhMin', numOrNull(e.target.value))} data-testid="dbh-min" />
        <span className="dash">–</span>
        <input className="input num" type="number" placeholder="max" value={filters.dbhMax ?? ''} onChange={(e) => set('dbhMax', numOrNull(e.target.value))} data-testid="dbh-max" />
      </div>
      <div className="fgroup">
        <span className="flabel">Height m</span>
        <input className="input num" type="number" placeholder="min" value={filters.heightMin ?? ''} onChange={(e) => set('heightMin', numOrNull(e.target.value))} />
        <span className="dash">–</span>
        <input className="input num" type="number" placeholder="max" value={filters.heightMax ?? ''} onChange={(e) => set('heightMax', numOrNull(e.target.value))} />
      </div>
      <div className="fgroup">
        <span className="flabel">Min scores</span>
        <ScoreSelect title="Straightness" short="Str" value={filters.minStraightness} onChange={(v) => set('minStraightness', v)} />
        <ScoreSelect title="Twist" short="Tw" value={filters.minTwist} onChange={(v) => set('minTwist', v)} />
        <ScoreSelect title="Branchiness" short="Br" value={filters.minBranchiness} onChange={(v) => set('minBranchiness', v)} />
      </div>
      <div className="fgroup">
        <select className="select" value={filters.product} onChange={(e) => set('product', e.target.value as Filters['product'])} data-testid="product-filter" aria-label="Product">
          <option value="all">Any product</option><option value="pole">Poles</option><option value="sawlog">Sawlogs</option><option value="none">No product</option>
        </select>
        <select className="select" value={filters.poleClass} onChange={(e) => set('poleClass', e.target.value)} aria-label="Pole class">
          <option value="">Any pole class</option>
          {poleClasses.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="select" value={filters.leave} onChange={(e) => set('leave', e.target.value as Filters['leave'])} aria-label="Leave trees">
          <option value="all">Leave trees: incl.</option><option value="exclude">Leave trees: excl.</option><option value="only">Leave trees only</option>
        </select>
      </div>
      <div className="fgroup">
        <MultiSelect label="Status" value={filters.status} onChange={(v) => set('status', v)}
          options={STATUSES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))} />
        <MultiSelect label="Marked by" value={filters.markedBy} onChange={(v) => set('markedBy', v)} testId="markedby-filter"
          options={users.map((u) => ({ value: u.id, label: `${u.tagPrefix} · ${u.name}` }))} />
      </div>
      <div className="fgroup">
        <span className="flabel">Date</span>
        <input className="input date" type="date" value={filters.dateFrom} onChange={(e) => set('dateFrom', e.target.value)} aria-label="From date" />
        <span className="dash">–</span>
        <input className="input date" type="date" value={filters.dateTo} onChange={(e) => set('dateTo', e.target.value)} aria-label="To date" />
      </div>
      <label className="fgroup check">
        <input type="checkbox" checked={filters.includeVoided} onChange={(e) => set('includeVoided', e.target.checked)} data-testid="include-voided" /> Include voided
      </label>
      <button className="btn ghost small reset" type="button" disabled={!active} onClick={() => onChange(DEFAULT_FILTERS)} data-testid="reset-filters">
        Reset{active ? ` (${active})` : ''}
      </button>
    </div>
  );
}

function ScoreSelect({ title, short, value, onChange }: { title: string; short: string; value: number; onChange: (v: number) => void }) {
  return (
    <select className={`select score-sel${value > 1 ? ' on' : ''}`} title={`Minimum ${title.toLowerCase()} (5 = best)`} aria-label={`Minimum ${title}`} value={value} onChange={(e) => onChange(Number(e.target.value))}>
      <option value={1}>{short} any</option>
      {[2, 3, 4, 5].map((n) => <option key={n} value={n}>{short} ≥ {n}</option>)}
    </select>
  );
}
