'use client';
import { useEffect, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MLMap, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Block, Tree } from '@timber/core';
import { bboxOf, centroidOf } from '@/lib/boundary';

type Geom = GeoJSON.Polygon | GeoJSON.MultiPolygon;
export type Basemap = 'plain' | 'imagery' | 'mapbox';

export interface MapTree { tree: Tree; color: string; dim: boolean }

export interface MapViewProps {
  trees: MapTree[];
  blocks: Block[];
  area: Geom | null;
  selectedIds: Set<string>;
  focusId: string | null;
  drawing: boolean;
  drawPoints: [number, number][];
  basemap: Basemap;
  fitKey: string; // change to trigger fit-to-area
  popupHtml: (t: Tree) => string;
  onTreeClick: (id: string, additive: boolean) => void;
  onDrawPoint: (p: [number, number]) => void;
  onDrawFinish: () => void;
  onBasemapError: () => void;
}

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const BG = '#123222';

function baseStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      imagery: {
        type: 'raster', tileSize: 256, maxzoom: 19,
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
      },
      ...(MAPBOX_TOKEN ? {
        mapbox: {
          type: 'raster' as const, tileSize: 256, maxzoom: 20,
          tiles: [`https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/256/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`],
          attribution: '© Mapbox © OpenStreetMap',
        },
      } : {}),
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': BG } },
      { id: 'imagery', type: 'raster', source: 'imagery', layout: { visibility: 'none' }, paint: { 'raster-saturation': -0.15 } },
      ...(MAPBOX_TOKEN ? [{ id: 'mapbox', type: 'raster' as const, source: 'mapbox', layout: { visibility: 'none' as const } }] : []),
    ],
  };
}

function gridData(center: [number, number]): { fine: GeoJSON.FeatureCollection; major: GeoJSON.FeatureCollection } {
  const fine: GeoJSON.Feature[] = []; const major: GeoJSON.Feature[] = [];
  const step = 0.001; const span = 0.05;
  const [cx, cy] = [Math.round(center[0] / 0.01) * 0.01, Math.round(center[1] / 0.01) * 0.01];
  for (let i = -span / step; i <= span / step; i++) {
    const x = cx + i * step * 1.5; const y = cy + i * step;
    const isMajor = Math.abs(i % 10) === 0;
    const lon: GeoJSON.Feature = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[x, cy - span], [x, cy + span]] } };
    const lat: GeoJSON.Feature = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[cx - span * 1.5, y], [cx + span * 1.5, y]] } };
    (isMajor ? major : fine).push(lon, lat);
  }
  return { fine: { type: 'FeatureCollection', features: fine }, major: { type: 'FeatureCollection', features: major } };
}

const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });

export default function MapView(props: MapViewProps) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const propsRef = useRef(props);
  propsRef.current = props;
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const labelMarkers = useRef<maplibregl.Marker[]>([]);
  const blockMarkers = useRef<maplibregl.Marker[]>([]);
  const gridCenter = useRef<string>('');

  // Create the map once.
  useEffect(() => {
    if (!el.current) return;
    const map = new maplibregl.Map({
      container: el.current, style: baseStyle(), center: [-120.35, 50.70], zoom: 14.5, maxZoom: 21,
      attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false,
    });
    mapRef.current = map;
    (window as unknown as { __timberMap?: MLMap }).__timberMap = map; // used by e2e tests
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    let basemapErrors = 0;
    map.on('error', (e) => {
      const src = (e as unknown as { sourceId?: string }).sourceId;
      if (src === 'imagery' || src === 'mapbox') {
        if (++basemapErrors === 4) propsRef.current.onBasemapError();
        return; // tile failures are expected offline; never spam the console
      }
      console.warn('map:', e.error?.message ?? e);
    });

    map.on('load', () => {
      map.addSource('grid-fine', { type: 'geojson', data: fc([]) });
      map.addSource('grid-major', { type: 'geojson', data: fc([]) });
      map.addSource('blocks', { type: 'geojson', data: fc([]) });
      map.addSource('area', { type: 'geojson', data: fc([]) });
      map.addSource('trees', { type: 'geojson', data: fc([]), promoteId: 'id' });
      map.addSource('draw', { type: 'geojson', data: fc([]) });

      map.addLayer({ id: 'grid-fine', type: 'line', source: 'grid-fine', minzoom: 14, paint: { 'line-color': '#ffffff', 'line-opacity': 0.045, 'line-width': 1 } });
      map.addLayer({ id: 'grid-major', type: 'line', source: 'grid-major', paint: { 'line-color': '#ffffff', 'line-opacity': 0.09, 'line-width': 1 } });
      map.addLayer({ id: 'blocks-fill', type: 'fill', source: 'blocks', paint: { 'fill-color': '#2d6a4f', 'fill-opacity': 0.35 } });
      map.addLayer({ id: 'blocks-line', type: 'line', source: 'blocks', paint: { 'line-color': '#95d5b2', 'line-width': 2, 'line-dasharray': [3, 2] } });
      map.addLayer({ id: 'area-fill', type: 'fill', source: 'area', paint: { 'fill-color': '#ff6b1a', 'fill-opacity': 0.07 } });
      map.addLayer({ id: 'area-line', type: 'line', source: 'area', paint: { 'line-color': '#ff6b1a', 'line-width': 2.5 } });
      const radius: maplibregl.ExpressionSpecification = ['interpolate', ['linear'], ['zoom'],
        13, ['+', 2, ['*', ['get', 'r'], 1.5]], 16, ['+', 4, ['*', ['get', 'r'], 4]], 19, ['+', 8, ['*', ['get', 'r'], 10]]];
      map.addLayer({ id: 'trees-sel', type: 'circle', source: 'trees', filter: ['==', ['get', 'sel'], 1],
        paint: { 'circle-radius': ['+', radius, 5], 'circle-color': 'rgba(255,107,26,0.25)', 'circle-stroke-color': '#ff6b1a', 'circle-stroke-width': 2.5 } });
      map.addLayer({ id: 'trees', type: 'circle', source: 'trees', paint: {
        'circle-radius': radius,
        'circle-color': ['get', 'color'],
        'circle-opacity': ['case', ['==', ['get', 'dim'], 1], 0.28, ['==', ['get', 'voided'], 1], 0.45, 0.95],
        'circle-stroke-color': ['case', ['==', ['get', 'leave'], 1], '#ffffff', '#06140d'],
        'circle-stroke-width': ['case', ['==', ['get', 'leave'], 1], 2, 1.2],
        'circle-stroke-opacity': ['case', ['==', ['get', 'dim'], 1], 0.3, 0.9],
      } });
      map.addLayer({ id: 'draw-fill', type: 'fill', source: 'draw', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#ff6b1a', 'fill-opacity': 0.12 } });
      map.addLayer({ id: 'draw-line', type: 'line', source: 'draw', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#ff6b1a', 'line-width': 2, 'line-dasharray': [2, 1.5] } });
      map.addLayer({ id: 'draw-pts', type: 'circle', source: 'draw', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 5, 'circle-color': '#fff', 'circle-stroke-color': '#ff6b1a', 'circle-stroke-width': 2.5 } });

      map.on('mouseenter', 'trees', () => { if (!propsRef.current.drawing) map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'trees', () => { if (!propsRef.current.drawing) map.getCanvas().style.cursor = ''; });
      map.on('click', (e) => {
        const p = propsRef.current;
        if (p.drawing) { p.onDrawPoint([e.lngLat.lng, e.lngLat.lat]); return; }
        const hit = map.queryRenderedFeatures(e.point, { layers: ['trees'] })[0];
        if (!hit) { popupRef.current?.remove(); return; }
        const id = String(hit.properties?.id);
        const t = p.trees.find((x) => x.tree.id === id)?.tree;
        p.onTreeClick(id, e.originalEvent.shiftKey || e.originalEvent.metaKey || e.originalEvent.ctrlKey);
        if (t) {
          popupRef.current?.remove();
          popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: '300px', offset: 10 })
            .setLngLat([t.lon, t.lat]).setHTML(p.popupHtml(t)).addTo(map);
        }
      });
      map.on('dblclick', (e) => { if (propsRef.current.drawing) { e.preventDefault(); propsRef.current.onDrawFinish(); } });
      map.on('moveend', updateLabels);
      setReady(true);
    });

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(el.current);
    return () => { ro.disconnect(); map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateLabels() {
    const map = mapRef.current; if (!map) return;
    labelMarkers.current.forEach((m) => m.remove());
    labelMarkers.current = [];
    if (map.getZoom() < 17.2) return;
    const b = map.getBounds();
    const visible = propsRef.current.trees.filter((t) => !t.dim && b.contains([t.tree.lon, t.tree.lat])).slice(0, 250);
    for (const { tree } of visible) {
      const div = document.createElement('div');
      div.className = 'map-tag-label';
      div.textContent = tree.tag;
      labelMarkers.current.push(new maplibregl.Marker({ element: div, anchor: 'left', offset: [10, 0] }).setLngLat([tree.lon, tree.lat]).addTo(map));
    }
  }

  // Basemap visibility.
  useEffect(() => {
    const map = mapRef.current; if (!map || !ready) return;
    map.setLayoutProperty('imagery', 'visibility', props.basemap === 'imagery' ? 'visible' : 'none');
    if (map.getLayer('mapbox')) map.setLayoutProperty('mapbox', 'visibility', props.basemap === 'mapbox' ? 'visible' : 'none');
    map.setPaintProperty('blocks-fill', 'fill-opacity', props.basemap === 'plain' ? 0.35 : 0.08);
  }, [props.basemap, ready]);

  // Blocks + grid.
  useEffect(() => {
    const map = mapRef.current; if (!map || !ready) return;
    (map.getSource('blocks') as GeoJSONSource).setData(fc(props.blocks.map((b) => ({ type: 'Feature', properties: { id: b.id, name: b.name }, geometry: b.boundary }))));
    blockMarkers.current.forEach((m) => m.remove());
    blockMarkers.current = props.blocks.map((b) => {
      const div = document.createElement('div');
      div.className = 'map-block-label';
      div.textContent = b.code || b.name;
      const [w, s, e, n] = bboxOf(b.boundary);
      return new maplibregl.Marker({ element: div, anchor: 'bottom-left' }).setLngLat([w + (e - w) * 0.02, n + (n - s) * 0.02]).addTo(map);
    });
    const c = props.blocks[0] ? centroidOf(props.blocks[0].boundary) : ([-120.35, 50.7] as [number, number]);
    const key = c.map((x) => x.toFixed(2)).join(',');
    if (key !== gridCenter.current) {
      gridCenter.current = key;
      const g = gridData(c);
      (map.getSource('grid-fine') as GeoJSONSource).setData(g.fine);
      (map.getSource('grid-major') as GeoJSONSource).setData(g.major);
    }
  }, [props.blocks, ready]);

  // Trees.
  useEffect(() => {
    const map = mapRef.current; if (!map || !ready) return;
    const features: GeoJSON.Feature[] = props.trees.map(({ tree: t, color, dim }) => ({
      type: 'Feature', id: t.id,
      properties: {
        id: t.id, color, dim: dim ? 1 : 0, sel: props.selectedIds.has(t.id) ? 1 : 0, voided: t.voided ? 1 : 0, leave: t.leaveTree ? 1 : 0,
        r: Math.min(1.6, Math.max(0.4, (t.dbhCm ?? 30) / 40)),
      },
      geometry: { type: 'Point', coordinates: [t.lon, t.lat] },
    }));
    // Draw dimmed first so in-area trees sit on top.
    features.sort((a, b) => (a.properties!.dim - b.properties!.dim) * -1 || a.properties!.sel - b.properties!.sel);
    (map.getSource('trees') as GeoJSONSource).setData(fc(features));
    updateLabels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.trees, props.selectedIds, ready]);

  // Area.
  useEffect(() => {
    const map = mapRef.current; if (!map || !ready) return;
    (map.getSource('area') as GeoJSONSource).setData(fc(props.area ? [{ type: 'Feature', properties: {}, geometry: props.area }] : []));
  }, [props.area, ready]);

  // Fit to area / blocks when fitKey changes.
  useEffect(() => {
    const map = mapRef.current; if (!map || !ready) return;
    const g = props.area ?? props.blocks[0]?.boundary;
    if (g) {
      const [w, s, e, n] = bboxOf(g);
      const wide = (el.current?.clientWidth ?? 0) > 760;
      map.fitBounds([[w, s], [e, n]], { padding: wide ? { top: 40, bottom: 30, left: 270, right: 240 } : 30, duration: 600, maxZoom: 18 });
    } else if (props.trees.length) {
      const xs = props.trees.map((t) => t.tree.lon); const ys = props.trees.map((t) => t.tree.lat);
      map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 50, duration: 600, maxZoom: 18 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.fitKey, ready]);

  // Pan to a tree selected from the table.
  useEffect(() => {
    const map = mapRef.current; if (!map || !ready || !props.focusId) return;
    const t = props.trees.find((x) => x.tree.id === props.focusId)?.tree;
    if (!t) return;
    const b = map.getBounds();
    const pad = 0.15; const dx = (b.getEast() - b.getWest()) * pad; const dy = (b.getNorth() - b.getSouth()) * pad;
    const inside = t.lon > b.getWest() + dx && t.lon < b.getEast() - dx && t.lat > b.getSouth() + dy && t.lat < b.getNorth() - dy;
    if (!inside) map.easeTo({ center: [t.lon, t.lat], duration: 500 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.focusId, ready]);

  // Drawing overlay.
  useEffect(() => {
    const map = mapRef.current; if (!map || !ready) return;
    const pts = props.drawPoints;
    const features: GeoJSON.Feature[] = pts.map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } }));
    if (pts.length >= 2) features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts.length >= 3 ? [...pts, pts[0]] : pts } });
    if (pts.length >= 3) features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...pts, pts[0]]] } });
    (map.getSource('draw') as GeoJSONSource).setData(fc(features));
    if (props.drawing) { map.doubleClickZoom.disable(); map.getCanvas().style.cursor = 'crosshair'; popupRef.current?.remove(); }
    else { map.doubleClickZoom.enable(); map.getCanvas().style.cursor = ''; }
  }, [props.drawPoints, props.drawing, ready]);

  return <div ref={el} className="map-canvas" data-testid="map" data-ready={ready ? '1' : '0'} data-tree-count={props.trees.filter((t) => !t.dim).length} />;
}
