import { useEffect, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type RasterTileSource, type StyleSpecification } from 'maplibre-gl';
import { SPECIES_COLORS, type Block, type Tree } from '@timber/core';
import { circlePolygon, geometryBbox } from '../lib/geo';
import { SATELLITE } from './tiles';

export interface MapPosition {
  lat: number;
  lon: number;
  accuracyM: number;
}

interface Props {
  trees: Tree[];
  blocks: Block[];
  position: MapPosition | null;
  /** Highlight + label this tree. */
  selectedId?: string | null;
  /** Always label these tags (e.g. the last saved tree). */
  labelIds?: string[];
  onSelect?: (treeId: string) => void;
  /** Ring colour per tree id (e.g. orange for pole-eligible). */
  rings?: Record<string, string>;
  className?: string;
  testId?: string;
  /** 'blocks': frame the block boundaries instead of following the GPS position. */
  fit?: 'follow' | 'blocks';
  /** Screen space (px) covered by overlays at the top, so "center" stays visible. */
  padTop?: number;
  /** Change to make the map re-read imagery tiles (e.g. after an offline download). */
  tileVersion?: number | string;
}

const DEFAULT_CENTER: [number, number] = [-120.35, 50.7];
const FALLBACK_COLOR = '#cfd8d3';

function baseStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      sat: {
        type: 'raster',
        tiles: [`offline://${SATELLITE.id}/{z}/{x}/{y}`],
        tileSize: 256,
        maxzoom: 19,
        attribution: SATELLITE.attribution,
      },
      grid: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      blocks: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      trees: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      me: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#0c1d14' } },
      { id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-opacity': 0.92, 'raster-fade-duration': 0 } },
      {
        id: 'grid',
        type: 'line',
        source: 'grid',
        paint: { 'line-color': '#2a4a39', 'line-width': 1, 'line-opacity': 0.7 },
      },
      {
        id: 'block-fill',
        type: 'fill',
        source: 'blocks',
        paint: { 'fill-color': '#ffd166', 'fill-opacity': 0.07 },
      },
      {
        id: 'block-line',
        type: 'line',
        source: 'blocks',
        paint: { 'line-color': '#ffd166', 'line-width': 3, 'line-dasharray': [3, 1.5] },
      },
      {
        id: 'acc',
        type: 'fill',
        source: 'me',
        filter: ['==', ['get', 'kind'], 'acc'],
        paint: { 'fill-color': '#4cc9f0', 'fill-opacity': 0.16 },
      },
      {
        id: 'acc-line',
        type: 'line',
        source: 'me',
        filter: ['==', ['get', 'kind'], 'acc'],
        paint: { 'line-color': '#4cc9f0', 'line-width': 1.5, 'line-opacity': 0.8 },
      },
      {
        id: 'tree-halo',
        type: 'circle',
        source: 'trees',
        filter: ['==', ['get', 'selected'], true],
        paint: { 'circle-radius': 22, 'circle-color': '#ff6b1a', 'circle-opacity': 0.35 },
      },
      {
        id: 'trees',
        type: 'circle',
        source: 'trees',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 4, 16, 8, 19, 14],
          'circle-color': ['get', 'color'],
          'circle-stroke-color': ['get', 'ring'],
          'circle-stroke-width': ['case', ['get', 'leave'], 3.5, 2.5],
          'circle-opacity': ['case', ['get', 'dim'], 0.35, 1],
        },
      },
      {
        id: 'me-dot',
        type: 'circle',
        source: 'me',
        filter: ['==', ['get', 'kind'], 'dot'],
        paint: {
          'circle-radius': 8,
          'circle-color': '#4cc9f0',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 3,
        },
      },
    ],
  };
}

/** A metric-ish graticule so the map has texture even with no basemap tiles. */
function gridFor(map: maplibregl.Map): GeoJSON.FeatureCollection {
  const b = map.getBounds();
  const z = map.getZoom();
  const stepM = z >= 17 ? 25 : z >= 16 ? 50 : z >= 15 ? 100 : z >= 13 ? 250 : 1000;
  const lat0 = b.getCenter().lat;
  const dLat = stepM / 111320;
  const dLon = stepM / (111320 * Math.cos((lat0 * Math.PI) / 180));
  const feats: GeoJSON.Feature[] = [];
  const s = Math.floor(b.getSouth() / dLat) * dLat;
  const w = Math.floor(b.getWest() / dLon) * dLon;
  for (let lat = s; lat <= b.getNorth() + dLat; lat += dLat)
    feats.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[b.getWest() - dLon, lat], [b.getEast() + dLon, lat]] } });
  for (let lon = w; lon <= b.getEast() + dLon; lon += dLon)
    feats.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[lon, b.getSouth() - dLat], [lon, b.getNorth() + dLat]] } });
  return { type: 'FeatureCollection', features: feats.slice(0, 400) };
}

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export function TreeMap({ trees, blocks, position, selectedId, labelIds, onSelect, rings, className, testId, fit = 'follow', padTop = 0, tileVersion }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const markers = useRef<maplibregl.Marker[]>([]);
  const fitted = useRef(false);
  const following = useRef(fit === 'follow');
  const [zoom, setZoom] = useState(15);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!el.current) return;
    if (!webglAvailable()) {
      setFailed(true);
      return;
    }
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: el.current,
        style: baseStyle(),
        center: position ? [position.lon, position.lat] : DEFAULT_CENTER,
        zoom: 15.5,
        attributionControl: { compact: true },
        pitchWithRotate: false,
        dragRotate: false,
        fadeDuration: 0,
      });
    } catch {
      setFailed(true);
      return;
    }
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 90, unit: 'metric' }), 'bottom-left');
    mapRef.current = map;
    map.on('load', () => {
      setLoaded(true);
      // Start with the attribution collapsed to its (i) button; it still opens on tap.
      map.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
      (map.getSource('grid') as GeoJSONSource).setData(gridFor(map));
    });
    map.on('moveend', () => {
      (map.getSource('grid') as GeoJSONSource | undefined)?.setData(gridFor(map));
      setZoom(map.getZoom());
    });
    map.on('dragstart', () => (following.current = false));
    map.on('click', 'trees', (e) => {
      const id = e.features?.[0]?.properties?.id;
      if (id) onSelectRef.current?.(String(id));
    });
    map.on('error', () => undefined); // tile errors are expected offline; never spam the console
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Blocks.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    (map.getSource('blocks') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: blocks.map((b) => ({ type: 'Feature', properties: { name: b.name }, geometry: b.boundary })),
    });
    if (blocks.length && (fit === 'blocks' ? !fitted.current : !fitted.current && !position)) {
      const [w, s, e, n] = geometryBbox(blocks[0].boundary);
      map.fitBounds([w, s, e, n], { padding: { top: 30 + padTop, bottom: 30, left: 30, right: 30 }, duration: 0 });
      fitted.current = true;
    }
  }, [blocks, loaded, position, fit]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || tileVersion === undefined) return;
    const src = map.getSource('sat') as RasterTileSource | undefined;
    src?.setTiles([`offline://${SATELLITE.id}/{z}/{x}/{y}?v=${tileVersion}`]);
  }, [tileVersion, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    map.setPadding({ top: padTop, bottom: 0, left: 0, right: 0 });
  }, [padTop, loaded]);

  // Trees.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const live = trees.filter((t) => !t.voided && !(t.lat === 0 && t.lon === 0));
    (map.getSource('trees') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: live.map((t) => ({
        type: 'Feature',
        properties: {
          id: t.id,
          color: (t.species && (SPECIES_COLORS as Record<string, string>)?.[t.species]) || FALLBACK_COLOR,
          ring: t.leaveTree ? '#ffffff' : rings?.[t.id] ?? '#0c1d14',
          leave: !!t.leaveTree,
          selected: t.id === selectedId,
          dim: t.status === 'cut',
        },
        geometry: { type: 'Point', coordinates: [t.lon, t.lat] },
      })),
    });
    // Tag labels as DOM markers (no glyph server needed offline).
    for (const m of markers.current) m.remove();
    markers.current = [];
    const always = new Set([...(labelIds ?? []), ...(selectedId ? [selectedId] : [])]);
    const labelled = zoom >= 17 ? live.slice(0, 150) : live.filter((t) => always.has(t.id));
    for (const t of labelled) {
      const div = document.createElement('div');
      div.className = always.has(t.id) ? 'map-label hot' : 'map-label';
      div.textContent = t.tag;
      markers.current.push(
        new maplibregl.Marker({ element: div, anchor: 'left', offset: [12, 0] }).setLngLat([t.lon, t.lat]).addTo(map),
      );
    }
  }, [trees, loaded, selectedId, labelIds, rings, zoom]);

  // Me + accuracy circle; follow until the user pans.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const feats: GeoJSON.Feature[] = [];
    if (position) {
      feats.push({
        type: 'Feature',
        properties: { kind: 'acc' },
        geometry: circlePolygon(position.lat, position.lon, Math.max(1, position.accuracyM)),
      });
      feats.push({ type: 'Feature', properties: { kind: 'dot' }, geometry: { type: 'Point', coordinates: [position.lon, position.lat] } });
      if (following.current) map.easeTo({ center: [position.lon, position.lat], duration: fitted.current ? 400 : 0 });
      if (fit === 'follow') fitted.current = true;
    }
    (map.getSource('me') as GeoJSONSource).setData({ type: 'FeatureCollection', features: feats });
  }, [position?.lat, position?.lon, position?.accuracyM, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const recenter = () => {
    following.current = true;
    if (position && mapRef.current) mapRef.current.easeTo({ center: [position.lon, position.lat], zoom: 17, duration: 300 });
  };

  return (
    <div className={`tree-map ${className ?? ''}`} data-testid={testId}>
      <div ref={el} className="tree-map-canvas" />
      {failed && <div className="map-fallback">Map unavailable (no WebGL)</div>}
      <button className="map-btn" aria-label="Center on me" onClick={recenter}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M12 2v3m0 14v3M2 12h3m14 0h3M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Zm0-4a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
        </svg>
      </button>
    </div>
  );
}
