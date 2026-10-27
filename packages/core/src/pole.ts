import type { PoleEvaluation, PoleSpec, TreeFields } from './types';

/**
 * Pole check. Eligible when the species is in the spec, height >= minLengthM,
 * straightness/twist/branchiness >= the minimums, not a leave tree, AND the tree
 * qualifies for at least one class (dbh >= minDbhCm and height >= minLengthM of
 * that class). poleClass is the first class satisfied (classes are best first).
 * Missing measurements count as failures (with a reason).
 */
export function evaluatePole(t: TreeFields, spec: PoleSpec): PoleEvaluation {
  const reasons: string[] = [];
  if (t.leaveTree) reasons.push('leave tree');
  if (!t.species) reasons.push('species not recorded');
  else if (!spec.species.includes(t.species)) reasons.push(`species ${t.species} not in pole spec`);
  if (t.heightM === undefined || t.heightM === null) reasons.push('height not recorded');
  else if (t.heightM < spec.minLengthM) reasons.push(`height ${t.heightM} m < ${spec.minLengthM} m`);
  const scales: [keyof TreeFields & ('straightness' | 'twist' | 'branchiness'), number][] = [
    ['straightness', spec.minStraightness],
    ['twist', spec.minTwist],
    ['branchiness', spec.minBranchiness],
  ];
  for (const [k, min] of scales) {
    const v = t[k];
    if (v === undefined || v === null) reasons.push(`${k} not recorded`);
    else if (v < min) reasons.push(`${k} ${v} < ${min}`);
  }
  let poleClass: string | null = null;
  if (t.dbhCm === undefined || t.dbhCm === null) reasons.push('dbh not recorded');
  else if (t.heightM !== undefined && t.heightM !== null) {
    const c = spec.classes.find((c) => t.dbhCm! >= c.minDbhCm && t.heightM! >= c.minLengthM);
    if (c) poleClass = c.name;
    else reasons.push(`dbh ${t.dbhCm} cm / height ${t.heightM} m meets no pole class`);
  }
  const eligible = reasons.length === 0 && poleClass !== null;
  return { eligible, poleClass: eligible ? poleClass : null, reasons };
}
