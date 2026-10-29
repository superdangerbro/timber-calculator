'use client';
import { SPECIES_COLORS, type AreaSummary, type SpeciesCode } from '@timber/core';
import { money, num, signed } from '@/lib/format';

export function TotalsBar({ summary, areaHa, areaName, compare, compareName, classOrder, priced }: {
  classOrder: string[]; summary: AreaSummary; areaHa: number | null; areaName: string; compare: AreaSummary | null; compareName?: string;
  /** False when the scenario has no $/m³ entered at all: values are shown as "not set". */
  priced: boolean;
}) {
  const unpriced = summary.unpricedCount > 0 ? `${summary.unpricedCount} trees have no $/m³` : null;
  const saw = Object.entries(summary.sawlogM3BySpecies).filter(([, v]) => (v ?? 0) > 0).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  const sawTotal = saw.reduce((a, [, v]) => a + (v ?? 0), 0);
  const delta = (cur: number, other: number | undefined, fmt: (n: number) => string) =>
    compare && other !== undefined && Math.abs(cur - other) > 0.004 ? (
      <span className={`delta ${cur - other > 0 ? 'up' : 'down'}`} title={`vs ${compareName}`}>{signed(cur - other, fmt)}</span>
    ) : null;
  const classes = classOrder.map((c) => [c, summary.polesByClass[c] ?? 0] as const).filter(([, n]) => n > 0);

  return (
    <section className="totals" data-testid="totals" aria-label="Area totals">
      <div className="stat lead">
        <span className="k">{areaName}</span>
        <span className="v" data-testid="total-trees">{summary.treeCount}<small> trees</small></span>
        <span className="sub">{areaHa !== null ? `${num(areaHa, 1)} ha` : 'No area defined'}{areaHa ? ` · ${num(summary.treeCount / areaHa, 1)}/ha` : ''}{summary.leaveTreeCount ? ` · ${summary.leaveTreeCount} leave` : ''}</span>
      </div>
      <div className="stat">
        <span className="k">Poles</span>
        <span className="v" data-testid="total-poles">{summary.poleCount}{delta(summary.poleCount, compare?.poleCount, (n) => String(Math.round(n)))}</span>
        <span className="sub chips">{classes.length ? classes.map(([c, n]) => <span key={c} className="mini">{c.replace('Class ', 'C')}: <b>{n}</b></span>) : 'none'}</span>
      </div>
      <div className="stat wide">
        <span className="k">Sawlog m³</span>
        <span className="v">{num(sawTotal, 1)}</span>
        <span className="sub chips">{saw.slice(0, 4).map(([sp, v]) => (
          <span key={sp} className="mini"><span className="dot" style={{ background: SPECIES_COLORS[sp as SpeciesCode] }} />{sp} <b>{num(v ?? 0, 1)}</b></span>
        ))}{saw.length > 4 && <span className="mini">+{saw.length - 4}</span>}</span>
      </div>
      <div className="stat">
        <span className="k">Total volume</span>
        <span className="v">{num(summary.totalVolumeM3, 1)}<small> m³</small></span>
        <span className="sub">{summary.treeCount ? `${num(summary.totalVolumeM3 / summary.treeCount, 2)} m³/tree` : '—'}</span>
      </div>
      {priced ? (
        <>
          <div className="stat">
            <span className="k">Pole value</span>
            <span className="v" data-testid="pole-value">{money(summary.poleValue)}</span>
            <span className="sub">{delta(summary.poleValue, compare?.poleValue, (n) => money(n)) ?? (summary.poleM3 ? `${money(summary.poleValue / summary.poleM3)}/m³` : '—')}</span>
          </div>
          <div className="stat">
            <span className="k">Sawlog value</span>
            <span className="v">{money(summary.sawlogValue)}</span>
            <span className="sub">{delta(summary.sawlogValue, compare?.sawlogValue, (n) => money(n)) ?? (sawTotal ? `${money(summary.sawlogValue / sawTotal)}/m³` : '—')}</span>
          </div>
          <div className="stat money">
            <span className="k">Total value</span>
            <span className="v" data-testid="total-value">{money(summary.totalValue)}</span>
            <span className={`sub${unpriced ? ' warn' : ''}`}>{unpriced ?? delta(summary.totalValue, compare?.totalValue, (n) => money(n)) ?? (areaHa ? `${money(summary.totalValue / areaHa)}/ha` : '')}</span>
          </div>
        </>
      ) : (
        <div className="stat wide unpriced">
          <span className="k">Value</span>
          <span className="v muted" data-testid="total-value">Prices not set</span>
          <span className="sub">Enter your $/m³ in What-if pricing to see values</span>
        </div>
      )}
    </section>
  );
}
