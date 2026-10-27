// Rule-based voice parser. Input is raw speech-recognition text ("Big fir,
// forty-two, about thirty metres, straight a four, no twist, clean"); output is
// the fields it found, a command if any, the words it could not use, and a
// confidence the app can use to decide whether to ask an LLM instead.
//
// Pipeline: normalise -> tokenise -> merge spoken numbers into number tokens ->
// run rule passes in priority order, each claiming ("using") tokens so a token
// is never interpreted twice (e.g. the 20 in "fork at twenty" belongs to the
// defect, never to height or DBH).

import type { ParseResult, Scale, SpeciesCode, TreeFields, VoiceCommand } from './types';
import { SPECIES } from './species';

// ---------------------------------------------------------------------------
// Tokens

interface Tok {
  /** Normalised word, or the numeric value as a string for number tokens. */
  w: string;
  /** What was said (for defect text and `unparsed`). */
  raw: string;
  num?: number;
  comma?: boolean;
  used: boolean;
}

type NumericField = 'dbhCm' | 'heightM' | 'straightness' | 'twist' | 'branchiness';

interface Assignment {
  field: NumericField;
  idx: number;
}

interface Ctx {
  toks: Tok[];
  fields: TreeFields;
  defects: string[];
  notes: string[];
  command: VoiceCommand | null;
  assignments: Assignment[];
}

// ---------------------------------------------------------------------------
// Vocabulary

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
};
const TEENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const DECIMAL_DIGITS: Record<string, number> = { ...UNITS, oh: 0, o: 0 };

/** Words that sound like a small number; only trusted right after a scale word. */
const SCALE_HOMOPHONES: Record<string, number> = {
  won: 1, to: 2, too: 2, tu: 2, for: 4, fore: 4,
};

const SCALE_WORDS: Record<string, 'straightness' | 'twist' | 'branchiness'> = {
  straight: 'straightness', straightness: 'straightness', straighter: 'straightness',
  twist: 'twist', twisted: 'twist', twisty: 'twist', twisting: 'twist', spiral: 'twist', spiralled: 'twist',
  branchy: 'branchiness', branchiness: 'branchiness', branches: 'branchiness', branching: 'branchiness',
  limby: 'branchiness', limbiness: 'branchiness', limbs: 'branchiness', limbed: 'branchiness',
  knotty: 'branchiness', knots: 'branchiness',
};
/** Tokens allowed between a scale word and its score: "straight, a four", "twist of two". */
const SCALE_SKIP = new Set([
  'a', 'an', 'is', 'of', 'about', 'maybe', 'like', 'around', 'at', 'its', 'it', 'be', 'say', 'call',
  'was', 'score', 'rated', 'rating', 'grade', 'probably', 'i', 'id', 'would', 'give', 'make',
]);

const DBH_KEYS = new Set(['dbh', 'diameter', 'diametre', 'diam', 'dia']);
const HEIGHT_KEYS = new Set(['height', 'heights', 'hight', 'length']);
const HEIGHT_TRAIL = new Set(['tall', 'high', 'long', 'height']);
const KEY_SKIP = new Set([
  'is', 'of', 'about', 'around', 'roughly', 'maybe', 'at', 'was', 'like', 'approximately', 'approx', 'say',
  'be', 'to', 'its', 'it', 'should', 'probably', 'call', 'a', 'an', 'make', 'that', 'just', 'over', 'under',
  'near', 'nearly', 'almost', 'around', 'guess', 'i', 'id', 'would', 'more', 'or', 'less',
]);
const CM_UNITS = new Set(['cm', 'cms', 'centimetre', 'centimetres', 'centimeter', 'centimeters', 'centimetres', 'centi', 'cent']);
const INCH_UNITS = new Set(['inch', 'inches', 'in.', 'inchs']);
const M_UNITS = new Set(['m', 'metre', 'metres', 'meter', 'meters', 'mtr', 'mtrs', 'mts', 'meters']);
const FT_UNITS = new Set(['feet', 'foot', 'ft', 'feets']);

const FILLERS = new Set([
  'um', 'uh', 'er', 'erm', 'ah', 'hmm', 'mm', 'okay', 'ok', 'so', 'well', 'the', 'a', 'an', 'is', 'it', 'its',
  'and', 'then', 'with', 'of', 'about', 'around', 'roughly', 'approximately', 'approx', 'maybe', 'like',
  'say', 'just', 'yeah', 'yes', 'yep', 'right', 'alright', 'big', 'small', 'nice', 'good', 'little',
  'tree', 'this', 'that', 'no', 'nope', 'make', 'actually', 'sorry', 'i', 'mean', 'correction', 'change',
  'to', 'too', 'wait', 'oops', 'hey', 'got', 'has', 'have', 'there', 'theres', 'here', 'heres', 'we', 'ive',
  'im', 'call', 'at', 'be', 'was', 'are', 'or', 'ish', 'guess', 'think', 'probably', 'real', 'really',
  'very', 'pretty', 'kinda', 'kind', 'sort', 'on', 'for', 'in', 'up', 'one', 'another', 'next', 'thing',
  'looks', 'look', 'looking', 'id', 'would', 'give', 'him', 'her', 'she', 'he', 'they', 'bit', 'got',
  'should', 'fine', 'decent', 'nearly', 'almost', 'over', 'under', 'near', 'more', 'less', 'lot', 'old',
  'young', 'huge', 'large', 'tiny', 'mature', 'another', 'stem', 'bole', 'trunk', 'guy', 'fella', 'beauty',
  'also', 'plus', 'set', 'put', 'down', 'as', 'than', 'not', 'quite',
]);

const CORRECTION_MARKERS = new Set(['no', 'nope', 'sorry', 'actually', 'correction', 'mean', 'oops', 'wait', 'make', 'change']);

const COMMANDS: { words: string[]; cmd: VoiceCommand }[] = (
  [
    [['save', 'it'], 'save'], [['save', 'tree'], 'save'], [['save', 'that'], 'save'], [['save'], 'save'],
    [['done'], 'save'], [['tag', 'it'], 'save'], [['tag', 'that'], 'save'], [['tag', 'tree'], 'save'],
    [['repeat', 'that'], 'repeat'], [['repeat'], 'repeat'], [['say', 'that', 'again'], 'repeat'],
    [['say', 'again'], 'repeat'], [['read', 'it', 'back'], 'repeat'], [['read', 'that', 'back'], 'repeat'],
    [['read', 'back'], 'repeat'],
    [['undo', 'last'], 'undo'], [['undo', 'that'], 'undo'], [['undo'], 'undo'], [['scratch', 'that'], 'undo'],
    [['measure', 'the', 'height'], 'measure_height'], [['measure', 'height'], 'measure_height'],
    [['cancel', 'that'], 'cancel'], [['cancel', 'tree'], 'cancel'], [['cancel'], 'cancel'],
    [['never', 'mind'], 'cancel'], [['nevermind'], 'cancel'], [['forget', 'it'], 'cancel'],
    [['next', 'tree'], 'new_tree'], [['new', 'tree'], 'new_tree'], [['next', 'one'], 'new_tree'],
  ] as [string[], VoiceCommand][]
)
  .map(([words, cmd]) => ({ words, cmd }))
  .sort((a, b) => b.words.length - a.words.length);

const DEFECT_SINGLE = new Set([
  'rot', 'rotten', 'rotted', 'rotting', 'rots', 'punky',
  'sweep', 'sweepy', 'swept',
  'fork', 'forked', 'forks', 'forking',
  'crook', 'crooked', 'crooks',
  'scar', 'scarred', 'scars',
  'conk', 'conks', 'conky',
  'catface', 'catfaced', 'catfaces', 'catfacing',
]);
const DEFECT_DOUBLE: [string, string][] = [
  ['dead', 'top'], ['dead', 'tops'], ['broken', 'top'], ['broken', 'tops'], ['spike', 'top'], ['spiked', 'top'],
  ['frost', 'crack'], ['frost', 'cracks'], ['frost', 'cracked'], ['cat', 'face'], ['cat', 'faced'],
  ['cat', 'faces'], ['blown', 'top'], ['snapped', 'top'],
];
const DEFECT_PRE = new Set([
  'a', 'bit', 'of', 'little', 'some', 'slight', 'slightly', 'small', 'minor', 'major', 'bad', 'badly', 'heavy',
  'heavily', 'lots', 'lot', 'butt', 'heart', 'root', 'stem', 'fire', 'lightning', 'double', 'old', 'kind',
  'sort', 'with', 'has', 'got', 'very', 'mild', 'moderate', 'severe', 'basal', 'top', 'big', 'and', 'large',
]);
const DEFECT_TAIL = new Set([
  'at', 'the', 'butt', 'base', 'bottom', 'top', 'in', 'on', 'near', 'from', 'up', 'down', 'halfway', 'half',
  'way', 'mid', 'middle', 'lower', 'upper', 'side', 'sides', 'both', 'north', 'south', 'east', 'west',
  'stump', 'ground', 'level', 'of', 'a', 'above', 'below', 'just', 'off', 'face', 'low', 'high', 'end',
  'bole', 'stem', 'trunk', 'first', 'second', 'third', 'log', 'slight', 'little', 'bit', 'uphill', 'downhill',
  'under', 'over', 'into', 'about', 'around', 'one', 'side',
]);
/** Prepositions after which a number inside a defect phrase belongs to the defect. */
const DEFECT_NUM_PREP = new Set(['at', 'from', 'above', 'below', 'near', 'up', 'under', 'over']);
const DEFECT_TRIM = new Set(['at', 'the', 'of', 'a', 'in', 'on', 'from', 'near', 'and', 'with', 'both', 'just', 'into', 'about', 'around', 'under', 'over']);
const DEFECT_LEAD_STRIP = new Set(['with', 'has', 'got', 'and']);
const NEGATORS = new Set(['no', 'not', 'without', 'zero', '0', 'none']);
/** After a homophone these mean it was a preposition ("straight to the top"), not a score. */
const HOMOPHONE_BLOCKERS = new Set(['a', 'an', 'the', 'pole', 'poles', 'sure', 'me', 'it', 'its', 'that', 'this']);

// Species aliases: longest first. Includes speech-recognition homophones and spelled codes.
const SPECIES_ALIASES: { words: string[]; code: SpeciesCode }[] = (() => {
  const list: { words: string[]; code: SpeciesCode }[] = [];
  for (const s of SPECIES) {
    for (const a of s.aliases) list.push({ words: a.split(' '), code: s.code });
    const letters = s.code.toLowerCase().split('');
    if (s.code !== 'AT' && s.code !== 'AC') list.push({ words: letters, code: s.code });
  }
  const extra: [string, SpeciesCode][] = [
    ['fur', 'FD'], ['dougfir', 'FD'], ['douglasfir', 'FD'], ['dfir', 'FD'],
    ['cedars', 'CW'], ['lodgepoles', 'PL'], ['subalpine', 'BL'], ['tamarac', 'LW'],
  ];
  for (const [w, code] of extra) list.push({ words: w.split(' '), code });
  return list.sort((a, b) => b.words.length - a.words.length);
})();
const SPECIES_FIRST_WORDS = new Set(SPECIES_ALIASES.filter((a) => a.words.length > 1 || a.words[0].length > 2).map((a) => a.words[0]));

// ---------------------------------------------------------------------------
// Normalise and tokenise

function normalise(text: string): string {
  let s = ` ${text.toLowerCase()} `;
  s = s.replace(/[‘’ʼ`]/g, "'");
  s = s.replace(/[–—]/g, ' , ');
  // "d.b.h.", "d b h", "D-B-H" -> dbh
  s = s.replace(/(^|[^a-z])d[\s.\-]*b[\s.\-]*h(?![a-z])\.?/g, '$1 dbh ');
  s = s.replace(/(\d),(\d{3})(?!\d)/g, '$1$2'); // 1,000
  s = s.replace(/(\d)\.(\d)/g, '$1§$2'); // protect decimals
  s = s.replace(/(\d)\s*["”]/g, '$1 inches ');
  s = s.replace(/(\d)\s*'(?![a-z])/g, '$1 feet ');
  s = s.replace(/'/g, '');
  s = s.replace(/[.,;:!?()\[\]{}"“”]/g, ' , ');
  s = s.replace(/§/g, '.');
  s = s.replace(/[-_/\\+*&#%=~^|<>]/g, ' ');
  s = s.replace(/(\d)([a-z])/g, '$1 $2').replace(/([a-z])(\d)/g, '$1 $2');
  return s;
}

function tokenise(text: string): Tok[] {
  const out: Tok[] = [];
  for (const piece of normalise(text).split(/\s+/)) {
    if (!piece) continue;
    if (piece === ',') {
      if (out.length && !out[out.length - 1].comma) out.push({ w: ',', raw: ',', comma: true, used: false });
      continue;
    }
    out.push({ w: piece, raw: piece, used: false });
  }
  return mergeNumbers(out);
}

const isDigits = (w: string) => /^\d+(\.\d+)?$/.test(w);

function readNumber(ws: Tok[], i: number): { value: number; end: number } | null {
  let j = i;
  let val = 0;
  let kind: null | 'unit' | 'teen' | 'tens' | 'hundred' | 'digits' = null;
  if (ws[j]?.w === 'a' && ws[j + 1]?.w === 'hundred') {
    val = 1;
    kind = 'unit';
    j++;
  }
  while (j < ws.length) {
    const w = ws[j].w;
    if (ws[j].comma) break;
    if (isDigits(w)) {
      if (kind !== null) break;
      val = parseFloat(w);
      kind = 'digits';
      j++;
      break;
    } else if (w in UNITS) {
      if (kind === null || kind === 'hundred' || kind === 'tens') {
        val += UNITS[w];
        kind = 'unit';
      } else break;
    } else if (w in TEENS) {
      if (kind === null || kind === 'hundred') {
        val += TEENS[w];
        kind = 'teen';
      } else break;
    } else if (w in TENS) {
      if (kind === null || kind === 'hundred') {
        val += TENS[w];
        kind = 'tens';
      } else break;
    } else if (w === 'hundred') {
      if (kind === 'unit' && val > 0 && val < 10) {
        val *= 100;
        kind = 'hundred';
      } else if (kind === null) {
        val = 100;
        kind = 'hundred';
      } else break;
    } else if (w === 'and' && kind === 'hundred') {
      const n = ws[j + 1]?.w;
      if (n && (n in UNITS || n in TEENS || n in TENS)) {
        j++;
        continue;
      }
      break;
    } else break;
    j++;
  }
  if (kind === null) return null;
  // "twenty eight point five", "28 point 5"
  if (ws[j]?.w === 'point' && !String(val).includes('.')) {
    let frac = '';
    let k = j + 1;
    while (k < ws.length) {
      const w = ws[k].w;
      if (w in DECIMAL_DIGITS) frac += String(DECIMAL_DIGITS[w]);
      else if (/^\d+$/.test(w)) frac += w;
      else break;
      k++;
    }
    if (frac) {
      val = parseFloat(`${Math.trunc(val)}.${frac}`);
      j = k;
    }
  }
  return { value: val, end: j };
}

function mergeNumbers(ws: Tok[]): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < ws.length) {
    const r = ws[i].comma ? null : readNumber(ws, i);
    if (r && r.end > i) {
      out.push({
        w: String(r.value),
        raw: ws.slice(i, r.end).map((t) => t.raw).join(' '),
        num: r.value,
        used: false,
      });
      i = r.end;
    } else {
      out.push(ws[i]);
      i++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helpers

const isNum = (t: Tok | undefined): t is Tok & { num: number } => !!t && t.num !== undefined;
const free = (t: Tok | undefined) => !!t && !t.used;

function matchSeq(toks: Tok[], i: number, words: string[]): boolean {
  for (let k = 0; k < words.length; k++) {
    const t = toks[i + k];
    if (!t || t.used || t.comma || t.w !== words[k]) return false;
  }
  return true;
}

function useRange(toks: Tok[], from: number, to: number) {
  for (let k = from; k < to; k++) toks[k].used = true;
}

/** Index of the next free token after i, skipping commas and words in `skip`. */
function nextAfter(toks: Tok[], i: number, skip: Set<string>, maxSkips = 3): number {
  let j = i + 1;
  let skips = 0;
  while (j < toks.length && skips < maxSkips && !toks[j].used && (toks[j].comma || skip.has(toks[j].w))) {
    j++;
    skips++;
  }
  return j;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function assign(ctx: Ctx, field: NumericField, value: number, idx: number) {
  if (field === 'dbhCm') ctx.fields.dbhCm = value;
  else if (field === 'heightM') {
    ctx.fields.heightM = value;
    ctx.fields.heightSource = 'spoken';
  } else ctx.fields[field] = value as Scale;
  ctx.assignments.push({ field, idx });
}

function isScaleValue(n: number | undefined): n is number {
  return n !== undefined && Number.isInteger(n) && n >= 1 && n <= 5;
}

// ---------------------------------------------------------------------------
// Rule passes

function passCommands(ctx: Ctx) {
  const { toks } = ctx;
  for (let i = 0; i < toks.length; i++) {
    for (const c of COMMANDS) {
      if (matchSeq(toks, i, c.words)) {
        useRange(toks, i, i + c.words.length);
        ctx.command = c.cmd; // last command wins
        break;
      }
    }
  }
}

function passNegations(ctx: Ctx) {
  const { toks } = ctx;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (!free(t)) continue;
    // "not a leave tree" / "not leave" / "no leave"
    if ((t.w === 'not' || t.w === 'no') && !t.used) {
      let j = i + 1;
      if (toks[j]?.w === 'a') j++;
      if (free(toks[j]) && (toks[j].w === 'leave' || toks[j].w === 'leaver')) {
        let end = j + 1;
        if (toks[end]?.w === 'tree') end++;
        useRange(toks, i, end);
        ctx.fields.leaveTree = false;
        continue;
      }
    }
    if (!NEGATORS.has(t.w)) continue;
    let j = i + 1;
    if (toks[j]?.w === 'real' || toks[j]?.w === 'visible' || toks[j]?.w === 'obvious') j++;
    const n = toks[j];
    if (!free(n)) continue;
    if (SCALE_WORDS[n.w] === 'twist') {
      useRange(toks, i, j + 1);
      assign(ctx, 'twist', 5, i);
    } else if (['limbs', 'branches', 'knots', 'limb', 'branch'].includes(n.w)) {
      useRange(toks, i, j + 1);
      assign(ctx, 'branchiness', 5, i);
    } else if (DEFECT_SINGLE.has(n.w) || ['defects', 'defect', 'damage'].includes(n.w)) {
      useRange(toks, i, j + 1);
    } else if (DEFECT_DOUBLE.some(([a, b]) => n.w === a && toks[j + 1]?.w === b)) {
      useRange(toks, i, j + 2);
    }
  }
}

function passStraightClean(ctx: Ctx) {
  const { toks } = ctx;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (!free(t)) continue;
    if (['dead', 'perfectly', 'arrow', 'ramrod', 'bang', 'dead-straight'].includes(t.w) && matchSeq(toks, i + 1, ['straight'])) {
      useRange(toks, i, i + 2);
      assign(ctx, 'straightness', 5, i);
    } else if (t.w === 'straight' && matchSeq(toks, i + 1, ['as', 'an', 'arrow'])) {
      useRange(toks, i, i + 4);
      assign(ctx, 'straightness', 5, i);
    } else if (t.w === 'clean' || t.w === 'clear') {
      // "clean" alone = branchiness 5; "clean four" / "clean a four" is a score (handled in passScales).
      const nx = toks[i + 1]?.w === 'a' ? toks[i + 2] : toks[i + 1];
      if (free(nx) && isNum(nx) && isScaleValue(nx.num)) continue;
      let end = i + 1;
      if (['bole', 'stem', 'trunk', 'stick', 'tree'].includes(toks[end]?.w ?? '')) end++;
      useRange(toks, i, end);
      assign(ctx, 'branchiness', 5, i);
    }
  }
}

function defectText(toks: Tok[], from: number, to: number): string {
  let a = from;
  while (a < to && DEFECT_LEAD_STRIP.has(toks[a].w)) a++;
  return toks
    .slice(a, to)
    .map((t) => (isNum(t) ? String(t.num) : t.raw))
    .join(' ');
}

function passDefects(ctx: Ctx) {
  const { toks } = ctx;
  for (let i = 0; i < toks.length; i++) {
    if (!free(toks[i]) || toks[i].comma) continue;
    let kwEnd = -1;
    if (DEFECT_SINGLE.has(toks[i].w)) kwEnd = i + 1;
    else {
      for (const [a, b] of DEFECT_DOUBLE) {
        if (matchSeq(toks, i, [a, b])) {
          kwEnd = i + 2;
          break;
        }
      }
    }
    if (kwEnd < 0) continue;

    // Extend backwards over modifiers ("a bit of", "butt", "bad").
    let start = i;
    while (start > 0 && free(toks[start - 1]) && !toks[start - 1].comma && DEFECT_PRE.has(toks[start - 1].w)) start--;

    // Extend forwards over the location tail ("at the butt", "at twenty", "20 feet up").
    let end = kwEnd;
    let j = kwEnd;
    let prevWord: string | null = toks[kwEnd - 1].w;
    let prevWasNum = false;
    while (j < toks.length) {
      const t = toks[j];
      if (t.used || t.comma) break;
      if (isNum(t)) {
        const afterPrep = prevWord !== null && DEFECT_NUM_PREP.has(prevWord);
        const n1 = toks[j + 1]?.w ?? '';
        const n2 = toks[j + 2]?.w ?? '';
        const lengthUp = (M_UNITS.has(n1) || FT_UNITS.has(n1)) && ['up', 'high', 'off', 'from', 'above'].includes(n2);
        if (!afterPrep && !lengthUp) break;
        prevWasNum = true;
        prevWord = null;
        j++;
        end = j;
        continue;
      }
      if (prevWasNum && (M_UNITS.has(t.w) || FT_UNITS.has(t.w))) {
        prevWasNum = false;
        prevWord = t.w;
        j++;
        end = j;
        continue;
      }
      if (DEFECT_TAIL.has(t.w) && !(SPECIES_FIRST_WORDS.has(t.w) && t.w !== 'top')) {
        prevWasNum = false;
        prevWord = t.w;
        j++;
        if (!DEFECT_TRIM.has(t.w)) end = j;
        continue;
      }
      break;
    }
    // Leading filler like "a" alone before the keyword is fine; trim nothing else.
    useRange(toks, start, end);
    ctx.defects.push(defectText(toks, start, end));
    i = end - 1;
  }
}

function passLeave(ctx: Ctx) {
  const { toks } = ctx;
  const phrases = [
    ['leave', 'tree'], ['wildlife', 'tree'], ['reserve', 'tree'], ['retention', 'tree'], ['leave', 'it'],
    ['leave'], ['leaver'], ['wildlife'],
  ];
  for (let i = 0; i < toks.length; i++) {
    for (const p of phrases) {
      if (matchSeq(toks, i, p)) {
        useRange(toks, i, i + p.length);
        ctx.fields.leaveTree = true;
        break;
      }
    }
  }
}

function passLogs(ctx: Ctx) {
  const { toks } = ctx;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (!free(t) || !isNum(t)) continue;
    const n = toks[i + 1];
    if (free(n) && (n.w === 'logs' || n.w === 'log')) {
      useRange(toks, i, i + 2);
      ctx.notes.push(`${t.num} ${t.num === 1 ? 'log' : 'logs'}`);
    }
  }
}

function passScales(ctx: Ctx) {
  const { toks } = ctx;
  // Forward: "straight five", "straight, a four", "twist to" (= 2), "limby three".
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (!free(t)) continue;
    const field = SCALE_WORDS[t.w];
    if (!field) continue;
    const j = nextAfter(toks, i, SCALE_SKIP, 3);
    const n = toks[j];
    if (!free(n)) continue;
    if (isNum(n) && isScaleValue(n.num)) {
      useRange(toks, i, j + 1);
      assign(ctx, field, n.num, i);
    } else if (n.w in SCALE_HOMOPHONES) {
      // "twist to three": the homophone is a preposition and the real score follows.
      const k = nextAfter(toks, j, SCALE_SKIP, 2);
      const after = toks[k];
      if (free(after) && isNum(after) && isScaleValue(after.num)) {
        useRange(toks, i, k + 1);
        assign(ctx, field, after.num, i);
      } else if (!(toks[j + 1] && HOMOPHONE_BLOCKERS.has(toks[j + 1].w))) {
        useRange(toks, i, j + 1);
        assign(ctx, field, SCALE_HOMOPHONES[n.w], i);
      }
    }
  }
  // Reverse: "four on straightness", "two twist".
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (!free(t) || !isNum(t) || !isScaleValue(t.num)) continue;
    let j = i + 1;
    if (['on', 'for', 'in', 'of'].includes(toks[j]?.w ?? '')) j++;
    const s = toks[j];
    if (free(s) && SCALE_WORDS[s.w]) {
      useRange(toks, i, j + 1);
      assign(ctx, SCALE_WORDS[s.w], t.num, i);
    }
  }
  // "clean four" style: branchiness score after "clean".
  for (let i = 0; i < toks.length; i++) {
    if (!free(toks[i]) || (toks[i].w !== 'clean' && toks[i].w !== 'clear')) continue;
    const j = toks[i + 1]?.w === 'a' ? i + 2 : i + 1;
    const n = toks[j];
    if (free(n) && isNum(n) && isScaleValue(n.num)) {
      useRange(toks, i, j + 1);
      assign(ctx, 'branchiness', n.num, i);
    }
  }
}

/** Consume an optional unit after number index j; returns [value converted, end index, kind]. */
function readUnit(toks: Tok[], j: number, value: number): { value: number; end: number; kind: 'cm' | 'in' | 'm' | 'ft' | null } {
  const u = toks[j + 1];
  if (free(u)) {
    if (CM_UNITS.has(u.w)) return { value, end: j + 2, kind: 'cm' };
    if (INCH_UNITS.has(u.w)) return { value: round1(value * 2.54), end: j + 2, kind: 'in' };
    if (M_UNITS.has(u.w)) return { value, end: j + 2, kind: 'm' };
    if (FT_UNITS.has(u.w)) return { value: round1(value * 0.3048), end: j + 2, kind: 'ft' };
  }
  return { value, end: j + 1, kind: null };
}

function passExplicit(ctx: Ctx) {
  const { toks } = ctx;
  // Keyword first: "dbh 42", "diameter is forty two", "height 28", "height is twenty six".
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (!free(t)) continue;
    const isDbh = DBH_KEYS.has(t.w);
    const isHeight = HEIGHT_KEYS.has(t.w);
    if (!isDbh && !isHeight) continue;
    const j = nextAfter(toks, i, KEY_SKIP, 4);
    const n = toks[j];
    if (free(n) && isNum(n)) {
      const u = readUnit(toks, j, n.num);
      let end = u.end;
      if (isHeight && free(toks[end]) && HEIGHT_TRAIL.has(toks[end].w)) end++;
      // A unit can override the keyword ("diameter ... 30 metres" is odd; trust the keyword unless unit is clearly the other kind).
      const field: NumericField = u.kind === 'm' || u.kind === 'ft' ? 'heightM' : u.kind === 'cm' || u.kind === 'in' ? 'dbhCm' : isDbh ? 'dbhCm' : 'heightM';
      useRange(toks, i, end);
      assign(ctx, field, u.value, j);
      continue;
    }
    // Backward: "forty two dbh", "42 cm diameter" (cm already handled by unit pass, see below).
    let k = i - 1;
    if (k >= 0 && free(toks[k]) && (CM_UNITS.has(toks[k].w) || INCH_UNITS.has(toks[k].w) || M_UNITS.has(toks[k].w))) k--;
    if (k >= 0 && free(toks[k]) && isNum(toks[k]) && isDbh) {
      const u = readUnit(toks, k, toks[k].num!);
      useRange(toks, k, i + 1);
      assign(ctx, 'dbhCm', u.value, k);
    }
  }
  // Units: "forty two cm", "16 inches", "thirty metres (tall)", "ninety feet", "thirty tall".
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (!free(t) || !isNum(t)) continue;
    const u = readUnit(toks, i, t.num);
    if (u.kind === 'cm' || u.kind === 'in') {
      let end = u.end;
      if (free(toks[end]) && DBH_KEYS.has(toks[end].w)) end++;
      useRange(toks, i, end);
      assign(ctx, 'dbhCm', u.value, i);
    } else if (u.kind === 'm' || u.kind === 'ft') {
      let end = u.end;
      if (free(toks[end]) && HEIGHT_TRAIL.has(toks[end].w)) end++;
      useRange(toks, i, end);
      assign(ctx, 'heightM', u.value, i);
    } else if (free(toks[i + 1]) && (toks[i + 1].w === 'tall' || toks[i + 1].w === 'high')) {
      useRange(toks, i, i + 2);
      assign(ctx, 'heightM', t.num, i);
    }
  }
}

function passSpecies(ctx: Ctx) {
  const { toks } = ctx;
  for (let i = 0; i < toks.length; i++) {
    if (!free(toks[i]) || toks[i].comma) continue;
    for (const a of SPECIES_ALIASES) {
      let ok = true;
      for (let k = 0; k < a.words.length; k++) {
        const t = toks[i + k];
        if (!t || t.used || t.comma) {
          ok = false;
          break;
        }
        const w = t.w;
        const single = a.words.length === 1 && w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w;
        if (w !== a.words[k] && single !== a.words[k]) {
          ok = false;
          break;
        }
      }
      if (ok) {
        useRange(toks, i, i + a.words.length);
        ctx.fields.species = a.code; // last mention wins ("fir, make that cedar")
        i += a.words.length - 1;
        break;
      }
    }
  }
}

const PLAUSIBLE: Record<NumericField, [number, number]> = {
  dbhCm: [5, 300],
  heightM: [1, 90],
  straightness: [1, 5],
  twist: [1, 5],
  branchiness: [1, 5],
};

function plausible(field: NumericField, v: number): boolean {
  const [lo, hi] = PLAUSIBLE[field];
  if (v < lo || v > hi) return false;
  if (field === 'straightness' || field === 'twist' || field === 'branchiness') return Number.isInteger(v);
  return true;
}

function passBareNumbers(ctx: Ctx) {
  const { toks } = ctx;
  let pendingCorrection = false;
  let bareDbhIdx = -1;
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.comma) continue;
    if (t.used) {
      if (isNum(t)) pendingCorrection = false;
      continue;
    }
    if (CORRECTION_MARKERS.has(t.w)) {
      pendingCorrection = true;
      continue;
    }
    if (!isNum(t)) continue;
    const v = t.num;
    if (pendingCorrection) {
      pendingCorrection = false;
      // Replace the last numeric field said before the correction, if the value fits it.
      const prior = ctx.assignments.filter((a) => a.idx < k).sort((a, b) => b.idx - a.idx)[0];
      if (prior && plausible(prior.field, v)) {
        t.used = true;
        assign(ctx, prior.field, v, k);
        continue;
      }
      if (v >= 10 && v <= 150) {
        t.used = true;
        assign(ctx, 'dbhCm', v, k);
        bareDbhIdx = k;
      }
      continue;
    }
    if (ctx.fields.dbhCm === undefined && v >= 8 && v <= 250) {
      t.used = true;
      assign(ctx, 'dbhCm', v, k);
      bareDbhIdx = k;
    } else if (bareDbhIdx >= 0 && bareDbhIdx < k && ctx.fields.heightM === undefined && v >= 3 && v <= 80) {
      // "fir forty two thirty": a second bare number after a bare DBH is the height.
      t.used = true;
      assign(ctx, 'heightM', v, k);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API

export function parseUtterance(text: string): ParseResult {
  const toks = tokenise(text ?? '');
  const ctx: Ctx = { toks, fields: {}, defects: [], notes: [], command: null, assignments: [] };

  passCommands(ctx);
  passNegations(ctx);
  passLogs(ctx);
  passStraightClean(ctx);
  passDefects(ctx);
  passLeave(ctx);
  passScales(ctx);
  passExplicit(ctx);
  passSpecies(ctx);
  passBareNumbers(ctx);

  if (ctx.defects.length) ctx.fields.defects = ctx.defects.join('; ');
  if (ctx.notes.length) ctx.fields.notes = ctx.notes.join('; ');

  let meaningful = 0;
  let understood = 0;
  const unparsed: string[] = [];
  for (const t of toks) {
    if (t.comma) continue;
    if (t.used) {
      meaningful++;
      understood++;
    } else if (!FILLERS.has(t.w)) {
      meaningful++;
      unparsed.push(t.raw);
    }
  }
  const confidence = meaningful === 0 ? 0 : Math.round((understood / meaningful) * 100) / 100;

  return { fields: ctx.fields, command: ctx.command, unparsed: unparsed.join(' '), confidence };
}

/** Merge newly parsed fields onto a draft. Later values win; defects are appended ("; "). */
export function mergeDraft(draft: TreeFields, fields: TreeFields): TreeFields {
  const out: TreeFields = { ...draft };
  for (const key of Object.keys(fields) as (keyof TreeFields)[]) {
    const v = fields[key];
    if (v === undefined) continue;
    if (key === 'defects' && typeof v === 'string') {
      const prev = out[key];
      if (prev && v) {
        const parts = prev.split('; ');
        out[key] = parts.includes(v) ? prev : `${prev}; ${v}`;
      } else if (v) out[key] = v;
      continue;
    }
    (out as Record<string, unknown>)[key] = v;
  }
  return out;
}

export const REQUIRED_FIELDS: (keyof TreeFields)[] = [
  'species',
  'dbhCm',
  'heightM',
  'straightness',
  'twist',
  'branchiness',
];

/** Required fields not yet in the draft. Leave trees only need species and DBH. */
export function missingFields(draft: TreeFields): (keyof TreeFields)[] {
  const req: (keyof TreeFields)[] = draft.leaveTree ? ['species', 'dbhCm'] : REQUIRED_FIELDS;
  return req.filter((k) => draft[k] === undefined || draft[k] === null);
}
