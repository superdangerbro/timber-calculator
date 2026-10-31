import { registerPlugin } from '@capacitor/core';
import type { Scale, SpeciesCode, TreeFields } from '@timber/core';
import type { Interpreter } from './types';

/**
 * Native bridge to ios-plugins/TimberAI/TimberAIPlugin.swift (Apple Foundation
 * Models, iOS 26, on-device so it works with no signal).
 */
interface TimberAIPlugin {
  availability(): Promise<{ available: boolean; reason?: string }>;
  interpret(opts: { text: string; draft: TreeFields }): Promise<{ fields: Record<string, unknown> | null }>;
}
const TimberAI = registerPlugin<TimberAIPlugin>('TimberAI');

const CODES: SpeciesCode[] = ['FD', 'CW', 'LW', 'PL', 'PY', 'SX', 'BL', 'HW', 'AT', 'EP', 'AC'];

/** The model output is untrusted: keep only well-formed, plausible values. */
export function sanitizeFields(raw: Record<string, unknown> | null | undefined): TreeFields | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: TreeFields = {};
  const num = (v: unknown, lo: number, hi: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined;
  const scale = (v: unknown) => {
    const n = num(v, 1, 5);
    return n === undefined ? undefined : (Math.round(n) as Scale);
  };
  const sp = typeof raw.species === 'string' ? (raw.species.toUpperCase() as SpeciesCode) : undefined;
  if (sp && CODES.includes(sp)) out.species = sp;
  const dbh = num(raw.dbhCm, 5, 250);
  if (dbh !== undefined) out.dbhCm = Math.round(dbh * 10) / 10;
  const h = num(raw.heightM, 1, 80);
  if (h !== undefined) {
    out.heightM = Math.round(h * 10) / 10;
    out.heightSource = 'spoken';
  }
  const s = scale(raw.straightness);
  if (s) out.straightness = s;
  const t = scale(raw.twist);
  if (t) out.twist = t;
  const b = scale(raw.branchiness);
  if (b) out.branchiness = b;
  if (typeof raw.defects === 'string' && raw.defects.trim()) out.defects = raw.defects.trim();
  if (typeof raw.leaveTree === 'boolean' && raw.leaveTree) out.leaveTree = true;
  return Object.keys(out).length ? out : null;
}

export class NativeInterpreter implements Interpreter {
  /** Becomes false once the plugin reports it is missing or the model is unavailable. */
  available = true;
  private checked: Promise<boolean> | null = null;
  async interpret(text: string, draft: TreeFields) {
    if (!this.available) return null;
    try {
      this.checked ??= TimberAI.availability().then(
        (a) => a.available,
        () => false, // plugin not compiled in (Capacitor.isPluginAvailable can lag behind registerPluginInstance)
      );
      if (!(await this.checked)) {
        this.available = false;
        return null;
      }
      const r = await TimberAI.interpret({ text, draft });
      return sanitizeFields(r.fields);
    } catch {
      return null;
    }
  }
}

export class NullInterpreter implements Interpreter {
  readonly available = false;
  async interpret() {
    return null;
  }
}
