import { useEffect, useState } from 'react';
import type { Tree } from '@timber/core';
import { useApp } from '../app';
import { useEmitter } from '../lib/emitter';
import { capturePhoto, compressImage } from '../lib/photo';
import { Icon } from './Icon';

/** Object URL for a photo id: the local copy, or downloaded once from the server. */
export function usePhotoUrl(photoId: string | null | undefined): { url: string | null; missing: boolean } {
  const { sync, repo } = useApp();
  const { photoVersion } = useEmitter(repo);
  const [state, setState] = useState<{ url: string | null; missing: boolean }>({ url: null, missing: false });
  useEffect(() => {
    if (!photoId) return;
    let live = true;
    let url: string | null = null;
    void sync.photoBlob(photoId).then((b) => {
      if (!live) return;
      if (!b) return setState({ url: null, missing: true });
      url = URL.createObjectURL(b);
      setState({ url, missing: false });
    });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [photoId, sync, photoVersion]);
  return state;
}

export function PhotoThumb({ photoId, onOpen, big }: { photoId: string; onOpen?: () => void; big?: boolean }) {
  const { url, missing } = usePhotoUrl(photoId);
  return (
    <button type="button" className={`photo-thumb${big ? ' big' : ''}`} onClick={onOpen} aria-label="Open photo" data-testid="photo-thumb">
      {url ? <img src={url} alt="Tree photo" data-testid="photo-img" /> : <span className="photo-ph">{missing ? 'Photo not on this phone yet' : 'Loading…'}</span>}
    </button>
  );
}

/** Full-screen photo; tap anywhere to close. */
export function PhotoViewer({ photoId, onClose }: { photoId: string; onClose: () => void }) {
  const { url } = usePhotoUrl(photoId);
  return (
    <div className="photo-viewer" onClick={onClose} role="dialog" aria-label="Photo" data-testid="photo-viewer">
      {url && <img src={url} alt="Tree photo" />}
      <button className="icon-btn viewer-close" aria-label="Close photo">
        <Icon name="x" />
      </button>
    </div>
  );
}

/** Take or pick, compress, and attach a photo to a tree. Resolves true when saved. */
export function usePhotoTaker() {
  const { repo, gps } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const take = async (treeId: string, source: 'camera' | 'library'): Promise<boolean> => {
    setError(null);
    const raw = await capturePhoto(source);
    if (!raw) return false;
    setBusy(true);
    try {
      const small = await compressImage(raw);
      const pos = gps.getState().last;
      await repo.addPhoto(treeId, { ...small, lat: pos?.lat ?? null, lon: pos?.lon ?? null });
      return true;
    } catch (e) {
      setError((e as Error).message || 'Could not save photo');
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { take, busy, error };
}

/** Camera / library buttons for a tree. */
export function PhotoButtons({ tree, onSaved, autoCamera }: { tree: Tree; onSaved?: (saved: boolean) => void; autoCamera?: boolean }) {
  const { platform } = useApp();
  const { take, busy, error } = usePhotoTaker();
  const go = async (source: 'camera' | 'library') => onSaved?.(await take(tree.id, source));
  useEffect(() => {
    // On the phone the camera opens straight away for the "photo" voice command.
    if (autoCamera && platform.native) void go('camera');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="photo-buttons">
      <button className="btn primary big" disabled={busy} onClick={() => void go('camera')} data-testid="photo-camera">
        <Icon name="camera" size={26} /> {busy ? 'Saving…' : 'Take photo'}
      </button>
      <button className="btn ghost big" disabled={busy} onClick={() => void go('library')} data-testid="photo-library">
        <Icon name="image" size={24} /> Library
      </button>
      {error && <div className="photo-err">{error}</div>}
    </div>
  );
}
