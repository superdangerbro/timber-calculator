import type { TreeFields, UnitSystem } from './types';
import { speciesName } from './species';
import { missingFields } from './parser';

const FIELD_SPEECH: Partial<Record<keyof TreeFields, string>> = {
  species: 'species',
  dbhCm: 'DBH',
  heightM: 'height',
  straightness: 'straightness',
  twist: 'twist',
  branchiness: 'branchiness',
};

function num(n: number): string {
  return String(Math.round(n * 10) / 10);
}

export interface ReadbackOptions {
  /** Units to speak lengths in. Default 'metric'. */
  units?: UnitSystem;
  /** How girth is taped. With 'circumference', a missing girth is spoken as "circumference". */
  measure?: 'circumference' | 'dbh';
}

/** "75 inches" / "190.5 centimetres" for a girth stored in cm. */
export function speakGirth(cm: number, units: UnitSystem = 'metric'): string {
  return units === 'imperial' ? `${num(cm / 2.54)} inches` : `${num(cm)} centimetres`;
}

/** "98 feet" / "30 metres" for a height stored in m (feet rounded to the foot). */
export function speakHeight(m: number, units: UnitSystem = 'metric'): string {
  return units === 'imperial' ? `${Math.round(m / 0.3048)} feet` : `${num(m)} metres`;
}

/**
 * Spoken read-back of a draft, e.g.
 * "Douglas-fir, 42 centimetres, 30 metres, straightness 4, twist 5. Missing: branchiness."
 * With a circumference: "Douglas-fir, circumference 75 inches, DBH 23.9 inches, 98 feet, ...".
 */
export function readbackText(draft: TreeFields, opts: ReadbackOptions = {}): string {
  const units = opts.units ?? 'metric';
  const parts: string[] = [];
  if (draft.leaveTree) parts.push('Leave tree');
  if (draft.species) parts.push(speciesName(draft.species));
  const hasCirc = draft.circumferenceCm !== undefined && draft.circumferenceCm !== null;
  if (hasCirc) parts.push(`circumference ${speakGirth(draft.circumferenceCm as number, units)}`);
  if (draft.dbhCm !== undefined && draft.dbhCm !== null) {
    parts.push(hasCirc ? `DBH ${speakGirth(draft.dbhCm, units)}` : speakGirth(draft.dbhCm, units));
  }
  if (draft.heightM !== undefined && draft.heightM !== null) parts.push(speakHeight(draft.heightM, units));
  if (draft.straightness !== undefined) parts.push(`straightness ${draft.straightness}`);
  if (draft.twist !== undefined) parts.push(`twist ${draft.twist}`);
  if (draft.branchiness !== undefined) parts.push(`branchiness ${draft.branchiness}`);
  if (draft.defects) parts.push(`defects: ${draft.defects}`);
  const missing = missingFields(draft).map((k) =>
    k === 'dbhCm' && opts.measure === 'circumference' ? 'circumference' : (FIELD_SPEECH[k] ?? String(k)),
  );
  let out = parts.length ? `${parts.join(', ')}.` : 'Nothing recorded.';
  if (missing.length) out += ` Missing: ${missing.join(', ')}.`;
  return out;
}

const DIGIT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

/**
 * Speakable tag: "J-0147" -> "Tag J, zero one four seven."
 * "CB12-J-0147" -> "Tag C B, one two, J, zero one four seven."
 * "J-L0003" -> "Tag J, L, zero zero zero three."
 * Letters are spelled and digits read one by one so it is unambiguous over a saw.
 */
export function tagSpeech(tag: string): string {
  const groups: string[] = [];
  for (const seg of tag.trim().toUpperCase().split(/[-\s]+/)) {
    for (const run of seg.match(/[A-Z]+|\d+/g) ?? []) {
      if (/^\d+$/.test(run)) groups.push(run.split('').map((d) => DIGIT_WORDS[Number(d)]).join(' '));
      else groups.push(run.split('').join(' '));
    }
  }
  return `Tag ${groups.join(', ')}.`;
}
