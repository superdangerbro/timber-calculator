import { Capacitor } from '@capacitor/core';

// Tree photos: capture (camera or library), shrink on the phone so they sync over
// weak signal, and fingerprint (sha-256) so the event log vouches for the image.

export const PHOTO_MAX_EDGE = 1280;
export const PHOTO_QUALITY = 0.7;
export const PHOTO_MAX_BYTES = 250 * 1024;

/** Scale (w, h) so the long edge is at most maxEdge; never upscales. */
export function fitSize(w: number, h: number, maxEdge = PHOTO_MAX_EDGE): { width: number; height: number } {
  const long = Math.max(w, h);
  if (!long || long <= maxEdge) return { width: Math.round(w), height: Math.round(h) };
  const k = maxEdge / long;
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

/**
 * Encode at decreasing quality (then smaller size) until the JPEG fits under
 * maxBytes. `encode` does the actual work, so the policy is testable without a canvas.
 */
export async function encodeUnderCap(
  encode: (width: number, height: number, quality: number) => Promise<Blob>,
  size: { width: number; height: number },
  maxBytes = PHOTO_MAX_BYTES,
): Promise<{ blob: Blob; width: number; height: number; quality: number }> {
  let { width, height } = size;
  let quality = PHOTO_QUALITY;
  let blob = await encode(width, height, quality);
  for (let i = 0; i < 8 && blob.size > maxBytes; i++) {
    if (quality > 0.45) quality = Math.round((quality - 0.1) * 100) / 100;
    else {
      width = Math.max(1, Math.round(width * 0.8));
      height = Math.max(1, Math.round(height * 0.8));
    }
    blob = await encode(width, height, quality);
  }
  return { blob, width, height, quality };
}

/** Shrink any image the browser can decode to a JPEG: long edge <= 1280 px, about 0.7 quality, < 250 KB. */
export async function compressImage(input: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(input, { imageOrientation: 'from-image' } as ImageBitmapOptions).catch(() => createImageBitmap(input));
  const size = fitSize(bitmap.width, bitmap.height);
  const encode = (width: number, height: number, quality: number) =>
    new Promise<Blob>((resolve, reject) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('No canvas'));
      ctx.drawImage(bitmap, 0, 0, width, height);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode photo'))), 'image/jpeg', quality);
    });
  const out = await encodeUnderCap(encode, size);
  bitmap.close?.();
  return { blob: out.blob, width: out.width, height: out.height };
}

/** Blob bytes (Blob.arrayBuffer is missing in some WebViews and in jsdom). */
export function blobBytes(b: Blob): Promise<ArrayBuffer> {
  if (typeof b.arrayBuffer === 'function') return b.arrayBuffer();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(b);
  });
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Open a hidden file input (camera on phones via capture, or the photo library). */
function pickFile(capture: boolean): Promise<Blob | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (capture) input.setAttribute('capture', 'environment');
    input.style.display = 'none';
    let done = false;
    const finish = (b: Blob | null) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(b);
    };
    input.addEventListener('change', () => finish(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => finish(null));
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Take a photo with the camera or pick one from the library. Native uses the
 * Capacitor Camera plugin; the web falls back to a file input.
 */
export async function capturePhoto(source: 'camera' | 'library'): Promise<Blob | null> {
  if (Capacitor.isNativePlatform()) {
    const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
    try {
      const p = await Camera.getPhoto({
        source: source === 'camera' ? CameraSource.Camera : CameraSource.Photos,
        resultType: CameraResultType.Uri,
        quality: 85,
        width: 1600,
        correctOrientation: true,
        saveToGallery: false,
      });
      if (!p.webPath) return null;
      return await (await fetch(p.webPath)).blob();
    } catch {
      return null; // cancelled
    }
  }
  return pickFile(source === 'camera');
}
