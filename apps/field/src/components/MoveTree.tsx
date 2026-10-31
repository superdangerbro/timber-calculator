import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { Tree, TreePosition } from '@timber/core';
import { useApp } from '../app';
import { useEmitter } from '../lib/emitter';
import { pinOffsetText } from '../lib/geo';
import { TreeMap } from '../map/TreeMap';
import { adjustedPosition } from '../state/tally';
import { Icon } from './Icon';

/** Full-screen "Move pin" for a saved tree. Saving writes an update event; the raw GPS fix is kept. */
export function MoveTree({ tree, onClose }: { tree: Tree; onClose: () => void }) {
  const { repo } = useApp();
  const r = useEmitter(repo);
  const units = r.settings.units;
  const start: TreePosition = {
    lat: tree.lat,
    lon: tree.lon,
    accuracyM: tree.accuracyM,
    fixCount: tree.fixCount,
    positionSource: tree.positionSource ?? 'gps',
    gpsLat: tree.gpsLat ?? tree.lat,
    gpsLon: tree.gpsLon ?? tree.lon,
    gpsAccuracyM: tree.gpsAccuracyM ?? tree.accuracyM,
  };
  const [pos, setPos] = useState<TreePosition>(start);
  const [busy, setBusy] = useState(false);
  const moved = pinOffsetText(pos, units);
  const changed = Math.abs(pos.lat - tree.lat) > 1e-9 || Math.abs(pos.lon - tree.lon) > 1e-9;

  const save = async () => {
    setBusy(true);
    try {
      await repo.moveTree(tree.id, pos);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="move-tree" data-testid="move-tree">
      <div className="move-tree-map">
        <TreeMap
          trees={r.trees.filter((t) => t.id !== tree.id)}
          blocks={r.blocks}
          position={null}
          pin={{ lat: tree.lat, lon: tree.lon }}
          adjusting
          onPinMove={(lat, lon) => setPos(adjustedPosition(start, lat, lon))}
          testId="move-map"
        />
        <div className="move-tree-tag">{tree.tag}</div>
      </div>
      <div className="adjust-panel move-tree-panel">
        <div className="adjust-title">
          <Icon name="gps" size={22} />
          <div>
            <b>Move {tree.tag}: put the crosshair on the tree</b>
            <span data-testid="move-offset">{moved ?? 'On the GPS fix. Drag the map to move it.'}</span>
          </div>
        </div>
        <div className="adjust-actions">
          <button className="btn ghost" onClick={onClose} data-testid="move-cancel">
            Cancel
          </button>
          <button
            className="btn ghost"
            onClick={() => setPos(adjustedPosition(start, start.gpsLat ?? start.lat, start.gpsLon ?? start.lon))}
            disabled={!moved}
            data-testid="move-reset"
          >
            Back to GPS
          </button>
          <button className="btn primary" onClick={() => void save()} disabled={busy || !changed} data-testid="move-save">
            Save spot
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
