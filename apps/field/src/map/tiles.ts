import maplibregl from 'maplibre-gl';
import type { LocalStore, TileRegion } from '../platform/types';

const MAPBOX_TOKEN = (import.meta as any).env?.VITE_MAPBOX_TOKEN as string | undefined;

export interface TileSource {
  id: string;
  name: string;
  url: (z: number, x: number, y: number) => string;
  attribution: string;
}

export const SATELLITE: TileSource = MAPBOX_TOKEN
  ? {
      id: 'mapbox-sat',
      name: 'Mapbox satellite',
      url: (z, x, y) =>
        `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/256/${z}/${x}/${y}@2x?access_token=${MAPBOX_TOKEN}`,
      attribution: '© Mapbox © OpenStreetMap © Maxar',
    }
  : {
      id: 'esri-imagery',
      name: 'Esri World Imagery',
      url: (z, x, y) =>
        `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    };

export function lon2tile(lon: number, z: number) {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}
export function lat2tile(lat: number, z: number) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

export function tilesForBbox(bbox: [number, number, number, number], minZoom: number, maxZoom: number) {
  const [w, s, e, n] = bbox;
  const out: { z: number; x: number; y: number }[] = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    const x0 = lon2tile(w, z);
    const x1 = lon2tile(e, z);
    const y0 = lat2tile(n, z);
    const y1 = lat2tile(s, z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push({ z, x, y });
  }
  return out;
}

export function tileKey(sourceId: string, z: number, x: number, y: number) {
  return `${sourceId}/${z}/${x}/${y}`;
}

/** 1x1 transparent PNG: returned for tiles we do not have so the map never errors. */
const EMPTY_PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='),
  (c) => c.charCodeAt(0),
).buffer;

let networkFailures = 0;

async function fetchWithTimeout(url: string, ms: number): Promise<ArrayBuffer | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

let registered = false;
/**
 * offline://{source}/{z}/{x}/{y}: serve stored tiles; if missing and online,
 * try the network (and stop trying after repeated failures, e.g. no signal).
 */
export function registerOfflineProtocol(store: LocalStore) {
  if (registered) return;
  registered = true;
  maplibregl.addProtocol('offline', async (params) => {
    const m = /^offline:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
    if (!m) return { data: EMPTY_PNG.slice(0) };
    const [, src, zs, xs, ys] = m;
    const z = +zs;
    const x = +xs;
    const y = +ys;
    const cached = await store.getTile(tileKey(src, z, x, y)).catch(() => undefined);
    if (cached) return { data: cached.slice(0) };
    if (src === SATELLITE.id && networkFailures < 6 && globalThis.navigator?.onLine !== false) {
      const data = await fetchWithTimeout(SATELLITE.url(z, x, y), 5000);
      if (data) {
        networkFailures = 0;
        return { data };
      }
      networkFailures++;
    }
    return { data: EMPTY_PNG.slice(0) };
  });
}

export interface DownloadProgress {
  done: number;
  failed: number;
  total: number;
  bytes: number;
}

/** Download a block's tiles (zoom 12-17 by default) into local storage. */
export async function downloadRegion(
  store: LocalStore,
  opts: { id: string; name: string; bbox: [number, number, number, number]; minZoom?: number; maxZoom?: number },
  onProgress: (p: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<TileRegion> {
  const minZoom = opts.minZoom ?? 12;
  const maxZoom = opts.maxZoom ?? 17;
  const tiles = tilesForBbox(opts.bbox, minZoom, maxZoom);
  const p: DownloadProgress = { done: 0, failed: 0, total: tiles.length, bytes: 0 };
  onProgress({ ...p });
  let i = 0;
  const worker = async () => {
    while (i < tiles.length && !signal?.aborted) {
      const t = tiles[i++];
      const data = await fetchWithTimeout(SATELLITE.url(t.z, t.x, t.y), 15000);
      if (data && data.byteLength > 0) {
        await store.putTile(opts.id, tileKey(SATELLITE.id, t.z, t.x, t.y), data);
        p.bytes += data.byteLength;
        p.done++;
      } else {
        p.failed++;
      }
      onProgress({ ...p });
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  const region: TileRegion = {
    id: opts.id,
    name: opts.name,
    bbox: opts.bbox,
    minZoom,
    maxZoom,
    tileCount: p.done,
    bytes: p.bytes,
    source: SATELLITE.id,
    createdAt: new Date().toISOString(),
  };
  await store.putRegion(region);
  return region;
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
