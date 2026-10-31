import type { Species, SpeciesCode } from './types';

/**
 * Interior BC species list. `aliases` are lowercase words or phrases a cruiser
 * might say; the voice parser matches the longest alias first, so
 * "alpine fir" is BL while "fir" alone is FD.
 */
export const SPECIES: Species[] = [
  {
    code: 'FD',
    name: 'Douglas-fir',
    aliases: ['fir', 'doug', 'doug fir', 'douglas', 'douglas fir', 'd fir', 'interior fir', 'fd'],
    conifer: true,
  },
  {
    code: 'CW',
    name: 'Western redcedar',
    aliases: ['cedar', 'red cedar', 'redcedar', 'western red cedar', 'western redcedar', 'cw'],
    conifer: true,
  },
  {
    code: 'LW',
    name: 'Western larch',
    aliases: ['larch', 'tamarack', 'western larch', 'lw'],
    conifer: true,
  },
  {
    code: 'PL',
    name: 'Lodgepole pine',
    aliases: ['lodgepole', 'lodge pole', 'lodgepole pine', 'lodge pole pine', 'pine', 'jack pine', 'pl'],
    conifer: true,
  },
  {
    code: 'PY',
    name: 'Ponderosa pine',
    aliases: ['ponderosa', 'ponderosa pine', 'yellow pine', 'bull pine', 'py'],
    conifer: true,
  },
  {
    code: 'SX',
    name: 'Interior spruce',
    aliases: ['spruce', 'white spruce', 'engelmann spruce', 'hybrid spruce', 'interior spruce', 'sx'],
    conifer: true,
  },
  {
    code: 'BL',
    name: 'Subalpine fir',
    aliases: ['balsam', 'balsam fir', 'sub alpine fir', 'subalpine fir', 'alpine fir', 'bl'],
    conifer: true,
  },
  {
    code: 'HW',
    name: 'Western hemlock',
    aliases: ['hemlock', 'western hemlock', 'hw'],
    conifer: true,
  },
  {
    code: 'AT',
    name: 'Trembling aspen',
    aliases: ['aspen', 'poplar', 'trembling aspen', 'quaking aspen'],
    conifer: false,
  },
  {
    code: 'EP',
    name: 'Paper birch',
    aliases: ['birch', 'paper birch', 'white birch', 'ep'],
    conifer: false,
  },
  {
    code: 'AC',
    name: 'Black cottonwood',
    aliases: ['cottonwood', 'black cottonwood', 'cotton wood'],
    conifer: false,
  },
];

/**
 * One colour per species, shared by both apps (map dots, table chips, legend).
 * Bright, saturated and mutually distinct so they read on the dark-green chrome,
 * on satellite imagery and on a blank background. Safety orange (#ff6b1a) is
 * deliberately not used: it is reserved for tags and primary actions.
 */
export const SPECIES_COLORS: Record<SpeciesCode, string> = {
  FD: '#ffd60a', // yellow
  CW: '#ff4d8d', // pink
  LW: '#a3e635', // lime
  PL: '#38bdf8', // sky blue
  PY: '#c084fc', // violet
  SX: '#2dd4bf', // teal
  BL: '#818cf8', // indigo
  HW: '#fb7185', // salmon red
  AT: '#f5f5f4', // near white
  EP: '#fde68a', // pale gold
  AC: '#d4a373', // tan
};

const BY_CODE = new Map<string, Species>(SPECIES.map((s) => [s.code, s]));

export function speciesByCode(code: string | null | undefined): Species | undefined {
  if (!code) return undefined;
  return BY_CODE.get(code.toUpperCase());
}

export function speciesName(code: string | null | undefined): string {
  if (!code) return '';
  return speciesByCode(code)?.name ?? code;
}
