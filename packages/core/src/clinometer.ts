/**
 * Tree height from a clinometer: horizontal distance to the tree and the angles
 * (degrees from horizontal, positive up) to the top and to the base.
 * height = distance × (tan(top) − tan(base)), rounded to 0.1 m.
 * Returns NaN for invalid input (non-positive distance, |angle| >= 90, top below base).
 */
export function heightFromAngles(input: { distanceM: number; topDeg: number; baseDeg: number }): number {
  const { distanceM, topDeg, baseDeg } = input;
  if (![distanceM, topDeg, baseDeg].every(Number.isFinite)) return NaN;
  if (distanceM <= 0 || Math.abs(topDeg) >= 90 || Math.abs(baseDeg) >= 90 || topDeg <= baseDeg) return NaN;
  const rad = Math.PI / 180;
  const h = distanceM * (Math.tan(topDeg * rad) - Math.tan(baseDeg * rad));
  return Math.round(h * 10) / 10;
}
