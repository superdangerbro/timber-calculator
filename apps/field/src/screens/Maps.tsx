import { useEffect, useRef, useState } from 'react';
import { polygonAreaHa, uuid, type Block } from '@timber/core';
import { useApp } from '../app';
import { useEmitter } from '../lib/emitter';
import { Icon } from '../components/Icon';
import { geometryBbox, parseBoundary } from '../lib/geo';
import { downloadRegion, formatBytes, SATELLITE, tilesForBbox, type DownloadProgress } from '../map/tiles';
import type { TileRegion } from '../platform/types';
import { TreeMap } from '../map/TreeMap';

function areaHa(b: Block) {
  try {
    return polygonAreaHa(b.boundary);
  } catch {
    return null;
  }
}

export function MapsScreen() {
  const { repo, platform, gps } = useApp();
  const r = useEmitter(repo);
  const gpsState = useEmitter(gps);
  const [regions, setRegions] = useState<TileRegion[]>([]);
  const [progress, setProgress] = useState<Record<string, DownloadProgress>>({});
  const [error, setError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<{ usage?: number; quota?: number } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const aborts = useRef<Record<string, AbortController>>({});

  const refresh = async () => {
    setRegions(await platform.store.getRegions());
    try {
      setEstimate((await navigator.storage?.estimate?.()) ?? null);
    } catch {
      setEstimate(null);
    }
  };
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const importFile = async (f: File) => {
    setError(null);
    try {
      const text = await f.text();
      const { name, geometry } = parseBoundary(text);
      const base = f.name.replace(/\.(geo)?json$|\.kml$/i, '');
      const code = /^[A-Z]{1,4}\d{1,4}$/i.test(name ?? base) ? (name ?? base).toUpperCase() : undefined;
      const block: Block = {
        id: uuid(),
        name: name || base,
        code,
        boundary: geometry,
        createdBy: repo.userId,
        createdAt: new Date().toISOString(),
      };
      await repo.putBlock(block);
      if (!repo.settings.activeBlockId) await repo.saveSettings({ activeBlockId: block.id });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const download = async (b: Block) => {
    const ctl = new AbortController();
    aborts.current[b.id] = ctl;
    const [w, s, e, n] = geometryBbox(b.boundary);
    const pad = 0.002;
    await downloadRegion(
      platform.store,
      { id: b.id, name: b.name, bbox: [w - pad, s - pad, e + pad, n + pad], minZoom: 12, maxZoom: 17 },
      (p) => setProgress((x) => ({ ...x, [b.id]: p })),
      ctl.signal,
    );
    delete aborts.current[b.id];
    await refresh();
  };

  const remove = async (id: string) => {
    await platform.store.deleteRegion(id);
    setProgress((x) => {
      const n = { ...x };
      delete n[id];
      return n;
    });
    await refresh();
  };

  const totalBytes = regions.reduce((a, x) => a + x.bytes, 0);

  return (
    <div className="page" data-testid="maps-screen">
      <header className="page-head">
        <h1>Maps</h1>
        <button className="btn primary" onClick={() => file.current?.click()} data-testid="import-boundary">
          <Icon name="upload" size={20} /> Import
        </button>
        <input
          ref={file}
          type="file"
          accept=".geojson,.json,.kml,application/geo+json,application/vnd.google-earth.kml+xml"
          hidden
          data-testid="boundary-file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importFile(f);
            e.target.value = '';
          }}
        />
      </header>

      {r.blocks.length > 0 && (
        <div className="maps-preview">
          <TreeMap
            trees={r.trees}
            blocks={r.blocks.filter((b) => !r.settings.activeBlockId || b.id === r.settings.activeBlockId)}
            position={gpsState.last ? { lat: gpsState.last.lat, lon: gpsState.last.lon, accuracyM: gpsState.last.accuracyM } : null}
            fit="blocks"
            tileVersion={totalBytes}
            testId="maps-preview"
          />
        </div>
      )}

      <div className="info-card">
        <div className="info-row">
          <span>Offline tiles</span>
          <b data-testid="tiles-bytes">{formatBytes(totalBytes)}</b>
        </div>
        <div className="info-row">
          <span>Basemap</span>
          <b>{SATELLITE.name}</b>
        </div>
        {estimate?.usage != null && (
          <div className="info-row">
            <span>Device storage used</span>
            <b>
              {formatBytes(estimate.usage)}
              {estimate.quota ? ` of ${formatBytes(estimate.quota)}` : ''}
            </b>
          </div>
        )}
        <p className="hint">Download each block's imagery (zoom 12–17) while you have signal. Trees, block lines and your position always show, even without tiles.</p>
      </div>

      {error && <div className="error-card">{error}</div>}

      {r.blocks.length === 0 && (
        <div className="empty-card">
          No blocks yet. Import a GeoJSON or KML boundary, or sign in and sync to get blocks from the office.
        </div>
      )}

      <ul className="block-list">
        {r.blocks.map((b) => {
          const region = regions.find((x) => x.id === b.id);
          const p = progress[b.id];
          const [w, s, e, n] = geometryBbox(b.boundary);
          const count = tilesForBbox([w - 0.002, s - 0.002, e + 0.002, n + 0.002], 12, 17).length;
          const active = r.settings.activeBlockId === b.id;
          const ha = areaHa(b);
          const busy = !!p && p.done + p.failed < p.total;
          const showProgress = !!p && (busy || p.failed > 0);
          return (
            <li key={b.id} className={active ? 'block-card active' : 'block-card'} data-testid={`block-${b.name}`}>
              <div className="block-head">
                <div>
                  <div className="block-name">{b.name}</div>
                  <div className="block-sub">
                    {ha != null ? `${ha.toFixed(1)} ha · ` : ''}
                    {count} tiles z12–17
                  </div>
                </div>
                {active ? (
                  <span className="badge active">Active</span>
                ) : (
                  <button className="btn ghost" onClick={() => repo.saveSettings({ activeBlockId: b.id, blockCode: r.settings.blockCode })}>
                    Use
                  </button>
                )}
              </div>
              {showProgress && (
                <div className="progress" data-testid="download-progress">
                  <div className="progress-bar">
                    <div style={{ width: `${p ? ((p.done + p.failed) / Math.max(1, p.total)) * 100 : 0}%` }} />
                  </div>
                  <div className="progress-text">
                    {p.done}/{p.total} tiles · {formatBytes(p.bytes)}
                    {p.failed ? ` · ${p.failed} failed (no signal?)` : ''}
                  </div>
                </div>
              )}
              <div className="block-actions">
                {busy ? (
                  <button className="btn ghost" onClick={() => aborts.current[b.id]?.abort()}>
                    Stop
                  </button>
                ) : (
                  <button className="btn primary" onClick={() => void download(b)} data-testid={`download-${b.name}`}>
                    <Icon name="download" size={20} /> {region ? 'Update map' : 'Download map'}
                  </button>
                )}
                {region && (
                  <>
                    <span className="region-size" data-testid={`region-${b.name}`}>
                      {region.tileCount} tiles · {formatBytes(region.bytes)}
                    </span>
                    <button className="icon-btn danger" aria-label="Delete tiles" onClick={() => void remove(b.id)} data-testid={`delete-${b.name}`}>
                      <Icon name="trash" />
                    </button>
                  </>
                )}
                {!region && !busy && (
                  <button
                    className="icon-btn"
                    aria-label="Remove block"
                    onClick={() => {
                      if (confirm(`Remove block ${b.name} from this phone?`)) void repo.deleteBlock(b.id);
                    }}
                  >
                    <Icon name="x" />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
