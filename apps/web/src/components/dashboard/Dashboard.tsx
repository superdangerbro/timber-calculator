'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  DEFAULT_SCENARIO, hasPrices, polygonAreaHa, speciesName, summarize, toCsv, toGeoJson, toKml, treesInArea, valueTree,
  type Block, type Scenario, type SpeciesCode, type Tree, type TreeValuation, type UserProfile,
} from '@timber/core';
import { AppHeader } from '../AppHeader';
import { PromptModal } from '../ui/PromptModal';
import { ToastProvider, useToast } from '../ui/Toast';
import { parseBoundaryFile } from '@/lib/boundary';
import { makeColorizer, type ColorBy } from '@/lib/colors';
import { DEFAULT_FILTERS, passesFilters, type Filters } from '@/lib/filters';
import { escapeHtml, money, num, shortDate } from '@/lib/format';
import { loadPref, savePref, REPORT_KEY, type ReportState } from '@/lib/prefs';
import { AreaControls, type Area } from './AreaControls';
import { FilterBar } from './FilterBar';
import { HistoryModal } from './HistoryModal';
import { Legend } from './Legend';
import type { Basemap, MapTree } from './MapView';
import { PricingPanel } from './PricingPanel';
import { TotalsBar } from './TotalsBar';
import { TreeTable, type EditFn, type Row } from './TreeTable';
import { VoidModal } from './VoidModal';

const MapView = dynamic(() => import('./MapView'), { ssr: false, loading: () => <div className="map-canvas map-loading">Loading map…</div> });

const HAS_MAPBOX = !!process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const DEFAULT_BASEMAP: Basemap = HAS_MAPBOX ? 'mapbox' : process.env.NEXT_PUBLIC_OFFLINE_BASEMAP === '1' ? 'plain' : 'imagery';
type Me = { id: string; name: string; email: string; prefix: string };

export function Dashboard({ me }: { me: Me }) {
  return <ToastProvider><DashboardInner me={me} /></ToastProvider>;
}

const stripMeta = (s: Scenario) => JSON.stringify({ ...s, id: undefined, name: undefined, updatedAt: undefined, createdBy: undefined });

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) { window.location.href = '/login'; throw new Error('Signed out'); }
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

function DashboardInner({ me }: { me: Me }) {
  const toast = useToast();
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [trees, setTrees] = useState<Tree[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [saved, setSaved] = useState<Scenario[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [working, setWorking] = useState<Scenario>(DEFAULT_SCENARIO);
  const [compareId, setCompareId] = useState('');
  const [savingScenario, setSavingScenario] = useState(false);

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [colorBy, setColorBy] = useState<ColorBy>('species');
  const [basemap, setBasemap] = useState<Basemap>(DEFAULT_BASEMAP);
  const [basemapNote, setBasemapNote] = useState<string | null>(null);
  const [area, setArea] = useState<Area>(null);
  const [onlyInArea, setOnlyInArea] = useState(true);
  const [fitKey, setFitKey] = useState('init');
  const [drawing, setDrawing] = useState(false);
  const [drawPoints, setDrawPoints] = useState<[number, number][]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [focusId, setFocusId] = useState<string | null>(null);
  const [scrollToId, setScrollToId] = useState<string | null>(null);
  const [historyTree, setHistoryTree] = useState<Tree | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [lightbox, setLightbox] = useState<string | null>(null);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement | null)?.closest?.('[data-photo]') as HTMLElement | null;
      if (btn?.dataset.photo) setLightbox(btn.dataset.photo);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);
  const [voidTree, setVoidTree] = useState<Tree | null>(null);
  const [prompt, setPrompt] = useState<null | 'scenario' | 'block'>(null);
  const [pricingOpen, setPricingOpen] = useState(true);
  const [mapH, setMapH] = useState<number | null>(null);
  const mainRef = useRef<HTMLDivElement>(null);

  // Restore per-viewer UI prefs.
  useEffect(() => {
    setColorBy(loadPref('colorBy', 'species'));
    const bm = loadPref<Basemap | null>('basemap', null);
    if (bm && (bm !== 'mapbox' || HAS_MAPBOX)) setBasemap(bm);
    setPricingOpen(loadPref('pricingOpen', window.innerWidth >= 1200));
    setMapH(loadPref<number | null>('mapH', null));
  }, []);

  // Load data.
  useEffect(() => {
    (async () => {
      try {
        const [t, b, s, u] = await Promise.all([
          api<{ trees: Tree[] }>('/api/trees'), api<{ blocks: Block[] }>('/api/blocks'),
          api<{ scenarios: Scenario[] }>('/api/scenarios'), api<{ users: UserProfile[] }>('/api/users'),
        ]);
        setTrees(t.trees); setBlocks(b.blocks); setUsers(u.users); setSaved(s.scenarios);
        const lastId = loadPref<string | null>('scenarioId', null);
        const first = s.scenarios.find((x) => x.id === lastId) ?? s.scenarios[0];
        if (first) { setActiveId(first.id); setWorking(first); }
        if (b.blocks[0]) setArea({ kind: 'block', name: b.blocks[0].code ?? b.blocks[0].name, geometry: b.blocks[0].boundary, blockId: b.blocks[0].id });
        setFitKey('loaded');
        setLoaded(true);
      } catch (e) {
        setLoadError((e as Error).message);
      }
    })();
  }, []);

  const userMap = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const valuations = useMemo(() => new Map<string, TreeValuation>(trees.map((t) => [t.id, valueTree(t, working)])), [trees, working]);
  const filtered = useMemo(() => trees.filter((t) => passesFilters(t, valuations.get(t.id), filters)), [trees, valuations, filters]);
  const inArea = useMemo(() => (area ? treesInArea(filtered, area.geometry) : filtered), [filtered, area]);
  const inAreaIds = useMemo(() => new Set(inArea.map((t) => t.id)), [inArea]);
  const colorizer = useMemo(() => makeColorizer(colorBy, inArea, valuations), [colorBy, inArea, valuations]);
  const mapTrees: MapTree[] = useMemo(
    () => filtered.map((t) => ({ tree: t, color: colorizer.color(t), dim: !!area && !inAreaIds.has(t.id) })),
    [filtered, colorizer, area, inAreaIds],
  );
  const tableTrees = onlyInArea ? inArea : filtered;
  // Same tag on two live trees (e.g. a phone tallied before its first sign-in).
  const dupTags = useMemo(() => {
    const seen = new Map<string, number>();
    for (const t of trees) if (!t.voided) seen.set(t.tag, (seen.get(t.tag) ?? 0) + 1);
    return new Set([...seen].filter(([, n]) => n > 1).map(([tag]) => tag));
  }, [trees]);
  const [dupOnly, setDupOnly] = useState(false);
  const rows: Row[] = useMemo(
    () => tableTrees.map((t) => ({ tree: t, val: valuations.get(t.id)!, user: userMap.get(t.createdBy) })),
    [tableTrees, valuations, userMap],
  );
  const summary = useMemo(() => summarize(inArea, working), [inArea, working]);
  const compareScenario = saved.find((s) => s.id === compareId) ?? null;
  const compareSummary = useMemo(() => (compareScenario ? summarize(inArea, compareScenario) : null), [inArea, compareScenario]);
  const areaHa = useMemo(() => (area ? polygonAreaHa(area.geometry) : null), [area]);
  const activeSaved = saved.find((s) => s.id === activeId) ?? null;
  const dirty = !activeSaved || stripMeta(activeSaved) !== stripMeta(working);
  const speciesPresent = useMemo(() => {
    const c = new Map<string, number>();
    for (const t of trees) if (t.species) c.set(t.species, (c.get(t.species) ?? 0) + 1);
    return [...c.keys()].sort((a, b) => c.get(b)! - c.get(a)!) as SpeciesCode[];
  }, [trees]);

  // ---------- selection ----------
  const selectTree = useCallback((id: string, additive: boolean, from: 'map' | 'table') => {
    setSelectedIds((prev) => {
      if (additive) { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; }
      return new Set([id]);
    });
    if (from === 'map') setScrollToId(id + ':' + Date.now()); else setFocusId(id + ':' + Date.now());
  }, []);
  const toggleRow = useCallback((id: string) => setSelectedIds((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);

  // ---------- edits (optimistic) ----------
  const postEvent = useCallback(async (tree: Tree, body: { type: string; payload: Record<string, unknown> }, optimistic: Tree, okText: string) => {
    setTrees((ts) => ts.map((t) => (t.id === tree.id ? optimistic : t)));
    try {
      const res = await api<{ tree: Tree | null }>(`/api/trees/${tree.id}/events`, { method: 'POST', body: JSON.stringify(body) });
      if (res.tree) setTrees((ts) => ts.map((t) => (t.id === tree.id ? res.tree! : t)));
      setHistoryVersion((v) => v + 1);
      toast(okText, 'ok');
    } catch (e) {
      setTrees((ts) => ts.map((t) => (t.id === tree.id ? tree : t)));
      toast(`Could not save ${tree.tag}: ${(e as Error).message}`, 'error');
    }
  }, [toast]);

  const onEdit: EditFn = useCallback((tree, { field, value }) => {
    if (field === 'status') {
      postEvent(tree, { type: 'status', payload: { status: value } }, { ...tree, status: value as Tree['status'] }, `${tree.tag} marked ${value}`);
    } else if (field === 'circumferenceCm' && typeof value === 'number') {
      // DBH is derived from the taped circumference.
      const fields = { circumferenceCm: value, dbhCm: Math.round((value / Math.PI) * 10) / 10 };
      postEvent(tree, { type: 'update', payload: { fields } }, { ...tree, ...fields }, `${tree.tag} updated`);
    } else if (field === 'dbhCm' && tree.circumferenceCm) {
      // A DBH typed directly replaces the circumference it was derived from.
      postEvent(tree, { type: 'update', payload: { fields: { dbhCm: value, circumferenceCm: null } } }, { ...tree, dbhCm: value as number, circumferenceCm: undefined }, `${tree.tag} updated`);
    } else {
      postEvent(tree, { type: 'update', payload: { fields: { [field]: value } } }, { ...tree, [field]: value }, `${tree.tag} updated`);
    }
  }, [postEvent]);
  const onHistory = useCallback((t: Tree) => setHistoryTree(t), []);
  const onVoid = useCallback((t: Tree) => setVoidTree(t), []);

  // ---------- scenarios ----------
  const selectScenario = (id: string) => {
    const s = saved.find((x) => x.id === id);
    if (!s) return;
    if (dirty && activeSaved && !confirm('Discard unsaved pricing changes?')) return;
    setActiveId(id); setWorking(s); savePref('scenarioId', id);
  };
  const saveScenario = async () => {
    if (!activeId) return;
    setSavingScenario(true);
    try {
      const { scenario } = await api<{ scenario: Scenario }>(`/api/scenarios/${activeId}`, { method: 'PUT', body: JSON.stringify({ ...working, name: activeSaved?.name ?? working.name }) });
      setSaved((ss) => ss.map((s) => (s.id === scenario.id ? scenario : s))); setWorking(scenario);
      toast(`Saved "${scenario.name}"`, 'ok');
    } catch (e) { toast((e as Error).message, 'error'); } finally { setSavingScenario(false); }
  };
  const saveScenarioAs = async (name: string) => {
    setSavingScenario(true);
    try {
      const { scenario } = await api<{ scenario: Scenario }>('/api/scenarios', { method: 'POST', body: JSON.stringify({ ...working, name }) });
      setSaved((ss) => [...ss, scenario]); setActiveId(scenario.id); setWorking(scenario); savePref('scenarioId', scenario.id);
      toast(`Saved scenario "${name}"`, 'ok');
    } catch (e) { toast((e as Error).message, 'error'); } finally { setSavingScenario(false); setPrompt(null); }
  };

  // ---------- area ----------
  const pickBlock = (id: string) => {
    const b = blocks.find((x) => x.id === id);
    if (b) { setArea({ kind: 'block', name: b.code ?? b.name, geometry: b.boundary, blockId: b.id }); setFitKey('block' + id + Date.now()); }
  };
  const startDraw = () => { setDrawing(true); setDrawPoints([]); };
  const cancelDraw = () => { setDrawing(false); setDrawPoints([]); };
  const drawRef = useRef(drawPoints);
  drawRef.current = drawPoints;
  const finishDraw = useCallback(() => {
    const pts = drawRef.current;
    const clean = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 1e-6);
    if (clean.length < 3) { toast('Add at least 3 corners to make an area', 'error'); return; }
    setArea({ kind: 'drawn', name: 'Drawn area', geometry: { type: 'Polygon', coordinates: [[...clean, clean[0]]] } });
    setDrawing(false);
    setDrawPoints([]);
  }, [toast]);
  useEffect(() => {
    if (!drawing) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'Escape') cancelDraw();
      if (e.key === 'Enter') finishDraw();
      if (e.key === 'Backspace') setDrawPoints((p) => p.slice(0, -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawing, finishDraw]);

  const importBoundary = async (f: File) => {
    try {
      const { geometry, name } = await parseBoundaryFile(f);
      setArea({ kind: 'imported', name, geometry }); setFitKey('import' + Date.now());
      toast(`Imported boundary "${name}" (${num(polygonAreaHa(geometry), 1)} ha)`, 'ok');
    } catch (e) { toast((e as Error).message, 'error'); }
  };
  const saveBlock = async (name: string, code: string) => {
    if (!area) return;
    try {
      const { block } = await api<{ block: Block }>('/api/blocks', { method: 'POST', body: JSON.stringify({ name, code: code || null, boundary: area.geometry }) });
      setBlocks((bs) => [...bs, block].sort((a, b) => a.name.localeCompare(b.name)));
      setArea({ kind: 'block', name: block.code ?? block.name, geometry: block.boundary, blockId: block.id });
      toast(`Saved block "${name}"`, 'ok');
    } catch (e) { toast((e as Error).message, 'error'); } finally { setPrompt(null); }
  };

  // ---------- exports ----------
  const exportName = (area?.name ?? 'all-trees').replace(/[^A-Za-z0-9_-]+/g, '_') + '_' + new Date().toISOString().slice(0, 10);
  const download = (text: string, type: string, ext: string) => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a'); a.href = url; a.download = `${exportName}.${ext}`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const exportRows = () => (selectedIds.size ? tableTrees.filter((t) => selectedIds.has(t.id)) : tableTrees);
  const doExport = (fmt: 'csv' | 'geojson' | 'kml') => {
    const list = exportRows();
    if (fmt === 'csv') download(toCsv(list, working), 'text/csv', 'csv');
    if (fmt === 'geojson') download(JSON.stringify(toGeoJson(list, working), null, 1), 'application/geo+json', 'geojson');
    if (fmt === 'kml') download(toKml(list, { name: area?.name ?? 'Trees', boundary: area?.geometry.type === 'Polygon' ? area.geometry : undefined }), 'application/vnd.google-earth.kml+xml', 'kml');
    toast(`Exported ${list.length} trees as ${fmt.toUpperCase()}`, 'ok');
  };
  const openReport = () => {
    const state: ReportState = { filters, area, scenario: working, scenarioName: activeSaved?.name ?? 'Unsaved scenario', dirty, createdAt: new Date().toISOString(), by: me.name };
    savePref(REPORT_KEY, state);
    window.open('/report', '_blank');
  };

  // ---------- popup ----------
  const popupHtml = useCallback((t: Tree) => {
    const v = valuations.get(t.id); const u = userMap.get(t.createdBy);
    const sc = (n?: number) => (n ? String(n) : '–');
    return `<div class="pop">
      <div class="pop-top"><span class="tag pop-tag">${escapeHtml(t.tag)}</span>${t.voided ? '<span class="badge bad">VOID</span>' : ''}${t.leaveTree ? '<span class="badge none">Leave</span>' : ''}</div>
      <div class="pop-sp">${escapeHtml(t.species ? `${t.species} · ${speciesName(t.species)}` : 'Species unknown')}</div>
      ${t.photos?.length ? `<div class="pop-photos">${t.photos.map((ph, i) => `<button type="button" class="pop-photo" data-photo="${escapeHtml(ph.id)}" aria-label="Open photo ${i + 1} of ${escapeHtml(t.tag)}"><img src="/api/photos/${escapeHtml(ph.id)}" alt="Photo of ${escapeHtml(t.tag)}" loading="lazy" data-testid="pop-photo-img"/></button>`).join('')}</div>` : ''}
      <div class="pop-grid">
        ${t.circumferenceCm ? `<span>Circumf.</span><b>${num(t.circumferenceCm, 1)} cm</b>` : ''}
        <span>DBH</span><b>${num(t.dbhCm, 1)} cm</b><span>Height</span><b>${num(t.heightM, 1)} m</b>
        <span>Str / Tw / Br</span><b>${sc(t.straightness)} / ${sc(t.twist)} / ${sc(t.branchiness)}</b>
        <span>Product</span><b>${v?.product === 'pole' ? `Pole ${escapeHtml(v.poleClass ?? '')}` : v?.product === 'sawlog' ? 'Sawlog' : '—'}</b>
        <span>Volume</span><b>${num(v?.volumeM3 ?? 0, 2)} m³</b><span>Value</span>${!v || v.product === 'none' ? '<b class="muted">—</b>' : !v.priced ? '<b class="muted">prices not set</b>' : `<b class="money">${money(v.value)}</b>`}
        <span>Status</span><b>${escapeHtml(t.status)}</b>
      </div>
      ${t.defects ? `<div class="pop-note">Defects: ${escapeHtml(t.defects)}</div>` : ''}
      ${t.notes ? `<div class="pop-note">${escapeHtml(t.notes)}</div>` : ''}
      <div class="pop-foot">${escapeHtml(u?.name ?? 'Unknown')} · ${escapeHtml(shortDate(t.createdAt))} · ±${num(t.accuracyM, 1)} m</div>
    </div>`;
  }, [valuations, userMap]);

  // ---------- splitter ----------
  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const main = mainRef.current; if (!main) return;
    const top = main.getBoundingClientRect().top; const total = main.getBoundingClientRect().height;
    const move = (ev: PointerEvent) => setMapH(Math.max(180, Math.min(total - 140, ev.clientY - top)));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); setMapH((h) => { savePref('mapH', h); return h; }); document.body.classList.remove('dragging'); };
    document.body.classList.add('dragging');
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const setPricing = (open: boolean) => { setPricingOpen(open); savePref('pricingOpen', open); };

  if (loadError) return <div className="center-msg"><h2>Could not load data</h2><p className="muted">{loadError}</p><button className="btn" onClick={() => location.reload()}>Retry</button></div>;

  return (
    <div className="app">
      <AppHeader user={me} active="dashboard">
        <span className="hdr-block">{area ? <>Area: <b>{area.name}</b></> : 'All trees'}</span>
      </AppHeader>
      <FilterBar filters={filters} onChange={setFilters} speciesPresent={speciesPresent} poleClasses={working.poleSpec.classes.map((c) => c.name)} users={users} />
      <TotalsBar priced={hasPrices(working)} classOrder={working.poleSpec.classes.map((c) => c.name)} summary={summary} areaHa={areaHa} areaName={area ? area.name : 'All filtered trees'} compare={compareSummary} compareName={compareScenario?.name} />

      <div className={`workspace${pricingOpen ? ' with-pricing' : ''}`}>
        <div className="main" ref={mainRef}>
          <div className="map-pane" style={mapH ? { height: mapH, flex: 'none' } : undefined}>
            <MapView
              trees={mapTrees} blocks={blocks} area={area?.geometry ?? null} selectedIds={selectedIds}
              focusId={focusId ? focusId.split(':')[0] : null}
              drawing={drawing} drawPoints={drawPoints} basemap={basemap} fitKey={fitKey} popupHtml={popupHtml}
              onTreeClick={(id, add) => selectTree(id, add, 'map')}
              onDrawPoint={(p) => setDrawPoints((pts) => [...pts, p])} onDrawFinish={finishDraw}
              onBasemapError={() => { setBasemap('plain'); setBasemapNote('Imagery unreachable (offline?) — showing plain map'); }}
            />
            {!loaded && <div className="map-overlay-msg">Loading trees…</div>}
            <AreaControls area={area} blocks={blocks} onPickBlock={pickBlock} onClear={() => { setArea(null); setFitKey('clear' + Date.now()); }}
              drawing={drawing} onStartDraw={startDraw} onImport={importBoundary} onSave={() => setPrompt('block')} onZoom={() => setFitKey('zoom' + Date.now())} />
            {drawing && (
              <div className="draw-banner" data-testid="draw-banner">
                <span><b>Drawing area</b> · click to add corners ({drawPoints.length}) · double-click or Finish to close</span>
                <button className="btn ghost small" onClick={() => setDrawPoints((p) => p.slice(0, -1))} disabled={!drawPoints.length}>Undo</button>
                <button className="btn ghost small" onClick={cancelDraw}>Cancel</button>
                <button className="btn primary small" onClick={finishDraw} disabled={drawPoints.length < 3} data-testid="finish-draw">Finish</button>
              </div>
            )}
            <Legend colorBy={colorBy} onColorBy={(c) => { setColorBy(c); savePref('colorBy', c); }} items={colorizer.legend}
              basemap={basemap} onBasemap={(b) => { setBasemap(b); setBasemapNote(null); savePref('basemap', b); }} basemapNote={basemapNote} hasMapbox={HAS_MAPBOX} />
            {!pricingOpen && <button className="btn map-pricing-btn" onClick={() => setPricing(true)} data-testid="open-pricing">$ What-if pricing</button>}
          </div>
          <div className="splitter" onPointerDown={startDrag} role="separator" aria-orientation="horizontal" aria-label="Resize map and table" title="Drag to resize"><span /></div>
          <div className="table-pane">
            <div className="table-toolbar">
              <div className="tt-left">
                <b data-testid="row-count">{rows.length}</b>&nbsp;<span className="muted">trees{area && onlyInArea ? ` in ${area.name}` : ''}</span>
                {selectedIds.size > 0 && <><span className="sep" /><span><b>{selectedIds.size}</b> selected</span><button className="btn ghost small" onClick={() => setSelectedIds(new Set())}>Clear</button></>}
                {area && (
                  <label className="check small-check"><input type="checkbox" checked={onlyInArea} onChange={(e) => setOnlyInArea(e.target.checked)} /> Only trees in area</label>
                )}
                {dupTags.size > 0 && (
                  <button className={`btn small dup-btn${dupOnly ? ' on' : ''}`} onClick={() => setDupOnly((v) => !v)} data-testid="dup-tags"
                    title="Two live trees share these tags. Re-tag one of each pair in the field app.">
                    ⚠ {dupTags.size} duplicate tag{dupTags.size === 1 ? '' : 's'}{dupOnly ? ' · show all' : ''}
                  </button>
                )}
                <span className="muted hint-edit">Click a value to edit</span>
              </div>
              <div className="tt-right">
                <span className="muted small">Export {selectedIds.size ? 'selected' : 'shown'}:</span>
                <button className="btn small" onClick={() => doExport('csv')} data-testid="export-csv">CSV</button>
                <button className="btn small" onClick={() => doExport('geojson')} data-testid="export-geojson">GeoJSON</button>
                <button className="btn small" onClick={() => doExport('kml')} data-testid="export-kml">KML</button>
                <button className="btn primary small" onClick={openReport} data-testid="open-report">Print report</button>
              </div>
            </div>
            <TreeTable rows={dupOnly && dupTags.size ? rows.filter((r) => dupTags.has(r.tree.tag)) : rows} dupTags={dupTags} selectedIds={selectedIds} onRowClick={(id, add) => selectTree(id, add, 'table')} onToggle={toggleRow}
              onToggleAll={(ids) => setSelectedIds(new Set(ids ?? []))} onEdit={onEdit} onHistory={onHistory} onVoid={onVoid}
              scrollToId={scrollToId ? scrollToId.split(':')[0] : null} />
          </div>
        </div>
        {pricingOpen && (
          <PricingPanel scenario={working} onChange={setWorking} saved={saved} activeId={activeId} onSelect={selectScenario}
            dirty={dirty} onSave={saveScenario} onSaveAs={() => setPrompt('scenario')} onRevert={() => activeSaved && setWorking(activeSaved)} saving={savingScenario}
            compareId={compareId} onCompare={setCompareId} current={summary} compare={compareSummary} onClose={() => setPricing(false)} />
        )}
      </div>

      {lightbox && (
        <div className="lightbox" role="dialog" aria-label="Photo" onClick={() => setLightbox(null)} data-testid="lightbox">
          <img src={`/api/photos/${lightbox}`} alt="Tree photo" />
          <button className="btn ghost small" aria-label="Close photo">✕</button>
        </div>
      )}
      {historyTree && <HistoryModal tree={historyTree} users={userMap} version={historyVersion} onClose={() => setHistoryTree(null)} />}
      {voidTree && (
        <VoidModal tree={voidTree} onClose={() => setVoidTree(null)} onConfirm={(reason) => {
          const t = voidTree; setVoidTree(null);
          postEvent(t, { type: 'void', payload: reason ? { reason } : {} }, { ...t, voided: true }, `${t.tag} voided`);
        }} />
      )}
      {prompt === 'scenario' && (
        <PromptModal title="Save pricing scenario" confirm="Save scenario" onClose={() => setPrompt(null)} onSubmit={(v) => saveScenarioAs(v.name)}
          fields={[{ key: 'name', label: 'Scenario name', placeholder: 'e.g. Dec prices, strict buyer spec', initial: activeSaved ? `${activeSaved.name} (copy)` : '', maxLength: 100 }]} />
      )}
      {prompt === 'block' && area && (
        <PromptModal title="Save area as block" confirm="Save block" onClose={() => setPrompt(null)} onSubmit={(v) => saveBlock(v.name, v.code)}
          fields={[{ key: 'name', label: 'Block name', placeholder: 'e.g. CB13 north unit', initial: area.kind === 'imported' ? area.name : '', maxLength: 200 }, { key: 'code', label: 'Code (optional, used in tags)', placeholder: 'CB13', maxLength: 20 }]}>
          <p className="muted" style={{ marginTop: 0 }}>{num(areaHa ?? 0, 1)} ha · {inArea.length} trees currently inside</p>
        </PromptModal>
      )}
    </div>
  );
}
