import { Motion } from '@capacitor/motion';
import type { MotionEngine, Orientation } from './types';

/**
 * Device orientation -> camera pitch. With the phone upright in portrait and the
 * back camera aimed at the horizon, beta = 90 deg. Tilting the top of the phone
 * back (aiming up the stem) increases beta, so pitch above horizon = beta - 90.
 */
export function pitchFromBeta(beta: number): number {
  return beta - 90;
}

function headingFrom(e: { alpha?: number | null; webkitCompassHeading?: number }): number | null {
  if (typeof e.webkitCompassHeading === 'number') return e.webkitCompassHeading;
  if (typeof e.alpha === 'number') return (360 - e.alpha) % 360;
  return null;
}

/** iOS 13+ (Safari and WKWebView) only delivers orientation after a permission prompt from a tap. */
export async function requestOrientationPermission(): Promise<boolean> {
  const DOE = (globalThis as any).DeviceOrientationEvent;
  if (!DOE || typeof DOE.requestPermission !== 'function') return true;
  try {
    return (await DOE.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}
export function orientationNeedsPermission(): boolean {
  return typeof (globalThis as any).DeviceOrientationEvent?.requestPermission === 'function';
}

export class NativeMotion implements MotionEngine {
  readonly kind = 'native' as const;
  async start(onOrientation: (o: Orientation) => void) {
    await requestOrientationPermission();
    const handle = await Motion.addListener('orientation', (e) => {
      onOrientation({ pitchDeg: pitchFromBeta(e.beta), headingDeg: headingFrom(e as any) });
    });
    return () => void handle.remove();
  }
}

export class WebMotion implements MotionEngine {
  readonly kind = 'web' as const;
  async start(onOrientation: (o: Orientation) => void) {
    // iOS Safari requires an explicit permission request from a user gesture (denied: slider still works).
    await requestOrientationPermission();
    const fn = (e: DeviceOrientationEvent) => {
      if (e.beta == null) return;
      onOrientation({ pitchDeg: pitchFromBeta(e.beta), headingDeg: headingFrom(e as any) });
    };
    window.addEventListener('deviceorientation', fn);
    return () => window.removeEventListener('deviceorientation', fn);
  }
}
