'use client';
import { useRef } from 'react';
import type { Block } from '@timber/core';

export type Geom = GeoJSON.Polygon | GeoJSON.MultiPolygon;
export type Area = { kind: 'block' | 'drawn' | 'imported'; name: string; geometry: Geom; blockId?: string } | null;

export function AreaControls({ area, blocks, onPickBlock, onClear, drawing, onStartDraw, onImport, onSave, onZoom }: {
  area: Area; blocks: Block[]; onPickBlock: (id: string) => void; onClear: () => void; drawing: boolean; onStartDraw: () => void;
  onImport: (f: File) => void; onSave: () => void; onZoom: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const value = !area ? '' : area.kind === 'block' ? area.blockId! : '__custom';
  return (
    <div className="map-card area-card" data-testid="area-controls">
      <span className="label" style={{ margin: 0 }}>Area</span>
      <select className="select small" value={value} onChange={(e) => (e.target.value ? onPickBlock(e.target.value) : onClear())} data-testid="area-select" disabled={drawing}>
        <option value="">All trees (no area)</option>
        {blocks.length > 0 && <optgroup label="Saved blocks">{blocks.map((b) => <option key={b.id} value={b.id}>{b.code ? `${b.code} · ` : ''}{b.name}</option>)}</optgroup>}
        {area && area.kind !== 'block' && <option value="__custom">{area.name}</option>}
      </select>
      <div className="area-btns">
        <button className="btn small" onClick={onStartDraw} disabled={drawing} data-testid="draw-btn" title="Click on the map to add corners">✎ Draw</button>
        <button className="btn small" onClick={() => fileRef.current?.click()} disabled={drawing} title="GeoJSON or KML boundary">⇪ Import</button>
        {area && area.kind !== 'block' && <button className="btn small" onClick={onSave} data-testid="save-block">Save as block</button>}
        {area && <button className="btn ghost small" onClick={onZoom} title="Zoom to area">⤢</button>}
      </div>
      <input ref={fileRef} type="file" hidden accept=".geojson,.json,.kml,.shp,.zip,application/geo+json,application/vnd.google-earth.kml+xml"
        data-testid="import-input" onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = ''; }} />
    </div>
  );
}
