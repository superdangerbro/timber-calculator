'use client';
import { COLOR_BY_OPTIONS, type ColorBy, type LegendItem } from '@/lib/colors';
import type { Basemap } from './MapView';

export function Legend({ colorBy, onColorBy, items, basemap, onBasemap, basemapNote, hasMapbox }: {
  colorBy: ColorBy; onColorBy: (c: ColorBy) => void; items: LegendItem[]; basemap: Basemap; onBasemap: (b: Basemap) => void;
  basemapNote: string | null; hasMapbox: boolean;
}) {
  return (
    <div className="map-card legend" data-testid="legend">
      <label className="legend-head">
        <span className="label" style={{ margin: 0 }}>Colour by</span>
        <select className="select small" value={colorBy} onChange={(e) => onColorBy(e.target.value as ColorBy)} data-testid="color-by">
          {COLOR_BY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      <ul>
        {items.map((it) => (
          <li key={it.label}><span className="dot" style={{ background: it.color }} /><span className="lbl" title={it.label}>{it.label}</span>{it.count !== undefined && <span className="cnt">{it.count}</span>}</li>
        ))}
        <li className="hint"><span className="dot ring" /><span className="lbl">White ring = leave tree</span></li>
      </ul>
      <div className="seg" role="group" aria-label="Basemap">
        <button className={basemap === 'plain' ? 'on' : ''} onClick={() => onBasemap('plain')}>Plain</button>
        <button className={basemap === 'imagery' ? 'on' : ''} onClick={() => onBasemap('imagery')}>Imagery</button>
        {hasMapbox && <button className={basemap === 'mapbox' ? 'on' : ''} onClick={() => onBasemap('mapbox')}>Mapbox</button>}
      </div>
      {basemapNote && <div className="bm-note">{basemapNote}</div>}
    </div>
  );
}
