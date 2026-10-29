// Shared data model for the field app, the web dashboard and the sync API.
// Field measurements are append-only events; a Tree is the current state
// folded from its events. Pricing (Scenario) never changes measurements.

export type SpeciesCode =
  | 'FD' // Douglas-fir
  | 'CW' // western redcedar
  | 'LW' // western larch
  | 'PL' // lodgepole pine
  | 'PY' // ponderosa pine
  | 'SX' // interior spruce
  | 'BL' // subalpine fir (balsam)
  | 'HW' // western hemlock
  | 'AT' // trembling aspen
  | 'EP' // paper birch
  | 'AC'; // cottonwood

export interface Species {
  code: SpeciesCode;
  name: string;
  /** Words a faller might say for this species ("fir", "doug", "cedar", "balsam"...). */
  aliases: string[];
  conifer: boolean;
}

export type TreeStatus = 'standing' | 'cut' | 'damaged' | 'missing';

/** Score 1..5, 5 = best (dead straight / no twist / clean). */
export type Scale = 1 | 2 | 3 | 4 | 5;

export interface GpsFix {
  lat: number;
  lon: number;
  /** Horizontal accuracy, metres (1 sigma as reported by the device). */
  accuracyM: number;
  altitudeM?: number | null;
  timestamp: number; // ms epoch
}

export interface AveragedPosition {
  lat: number;
  lon: number;
  /** Estimated accuracy of the averaged position, metres. */
  accuracyM: number;
  fixCount: number;
}

/** Everything that can be measured or said about a tree. All optional while drafting. */
export interface TreeFields {
  species?: SpeciesCode;
  /** Diameter at breast height, cm. Derived from circumference (C / pi) when that was measured. */
  dbhCm?: number;
  /**
   * Circumference at breast height, cm, when that is what was measured. null means
   * "cleared" (DBH was given directly afterwards).
   */
  circumferenceCm?: number | null;
  /** Marketable (merchantable) height, metres. */
  heightM?: number;
  /** How the height was obtained. */
  heightSource?: 'spoken' | 'clinometer' | 'estimated';
  straightness?: Scale;
  twist?: Scale;
  branchiness?: Scale;
  defects?: string;
  leaveTree?: boolean;
  notes?: string;
}

/** A photo attached to a tree. The image bytes sync separately, keyed by id. */
export interface TreePhoto {
  id: string; // uuid v4
  takenAt: string; // ISO
  lat?: number | null;
  lon?: number | null;
  width: number;
  height: number;
  bytes: number;
  /** sha-256 hex of the JPEG bytes, so the event log vouches for the image. */
  sha256: string;
}

/** Display/readback units. Storage is always metric. */
export type UnitSystem = 'metric' | 'imperial';

export type TreeEventType = 'create' | 'update' | 'void' | 'status';

export interface TreeEvent {
  id: string; // uuid v4
  treeId: string; // uuid v4
  /** 1-based sequence within the tree. create = 1. */
  seq: number;
  type: TreeEventType;
  /**
   * create: { tag, tagNumber, prefix, blockId?, position, fields }
   * update: { fields } (partial; only changed fields) and/or { photos: TreePhoto[] } (appended)
   * void:   { reason? }
   * status: { status, stumpDiameterCm? }
   */
  payload: Record<string, unknown>;
  userId: string;
  deviceId: string;
  createdAt: string; // ISO
  /** Hash of the previous event by this device (chain is per device), '' for the first. */
  prevHash: string;
  /** sha-256 hex of canonical JSON of this event without `hash`. */
  hash: string;
}

export interface Tree extends TreeFields {
  id: string;
  /** Display tag, e.g. "J-0147" or "CB12-J-0147". Leave trees use the "L" series, e.g. "J-L0003". */
  tag: string;
  tagNumber: number;
  prefix: string;
  blockId?: string | null;
  lat: number;
  lon: number;
  accuracyM: number;
  fixCount: number;
  status: TreeStatus;
  voided: boolean;
  stumpDiameterCm?: number | null;
  createdBy: string; // userId
  deviceId: string;
  createdAt: string;
  updatedAt: string;
  /** Photos in the order they were added; the first is the thumbnail. */
  photos?: TreePhoto[];
  /** Number of events folded into this tree. */
  version: number;
}

export interface Block {
  id: string;
  name: string;
  code?: string; // e.g. "CB12", used as optional tag prefix
  /** GeoJSON Polygon or MultiPolygon geometry. */
  boundary: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  createdBy: string;
  createdAt: string;
}

/** Placeholder pole spec until Joe confirms buyer specs. All editable in a Scenario. */
export interface PoleSpec {
  species: SpeciesCode[];
  minLengthM: number;
  minStraightness: Scale;
  minTwist: Scale;
  minBranchiness: Scale;
  /** Pole classes, best first. A tree gets the first class it satisfies. */
  classes: PoleClassRule[];
}

export interface PoleClassRule {
  name: string; // e.g. "Class 2"
  minDbhCm: number;
  minLengthM: number;
}

export interface Scenario {
  id: string;
  name: string; // "Nov prices", "strict pole spec"
  /** $ per m³ (gross volume) for poles, by pole class name. Empty until prices are entered. */
  polePricePerM3: Record<string, number>;
  /** $ per m³ (net volume) for sawlog by species. Empty until prices are entered. */
  sawlogPricePerM3: Partial<Record<SpeciesCode, number>>;
  poleSpec: PoleSpec;
  /** BC BEC zone for the Kozak taper volume equations (e.g. "ICH", "IDF", "SBS"). Default ICH. */
  becZone?: string;
  /** Marketable top diameter, inside-bark cm, that spoken heights run to. Default 15 (about 6 inches). */
  topDibCm?: number;
  /**
   * Optional per-species override, V = a * DBH(cm)^b * H(m)^c (m³). Species not
   * listed use the BC Kozak taper equations.
   */
  volumeCoefficients?: Partial<Record<SpeciesCode, { a: number; b: number; c: number }>>;
  /** Fraction of volume deducted when defects are recorded (0..1). */
  defectDeduction: number;
  updatedAt: string;
}

export interface PoleEvaluation {
  eligible: boolean;
  poleClass: string | null;
  /** Human readable reasons the tree failed, empty if eligible. */
  reasons: string[];
}

export interface TreeValuation {
  treeId: string;
  product: 'pole' | 'sawlog' | 'none'; // none = voided, leave tree, or missing data
  poleClass: string | null;
  volumeM3: number;
  value: number; // dollars
  /** False when the $/m³ for this tree's product is not set; value is then 0. */
  priced: boolean;
}

export interface AreaSummary {
  treeCount: number;
  poleCount: number;
  polesByClass: Record<string, number>;
  sawlogM3BySpecies: Partial<Record<SpeciesCode, number>>;
  totalVolumeM3: number;
  poleValue: number;
  sawlogValue: number;
  totalValue: number;
  leaveTreeCount: number;
  sawlogCount: number;
  /** Gross volume of pole trees, m³. */
  poleM3: number;
  /** Net sawlog volume, m³. */
  sawlogM3: number;
  /** Pole or sawlog trees whose $/m³ is not set (their value counts as 0). */
  unpricedCount: number;
}

/** Result of parsing one spoken utterance. */
export interface ParseResult {
  /** Fields found in this utterance (merged onto the draft by the caller with mergeDraft). */
  fields: TreeFields;
  /** Command words found: "save", "repeat", "undo last", "measure height", "cancel". */
  command: VoiceCommand | null;
  /** Words the parser could not use, for LLM fallback or display. */
  unparsed: string;
  /** 0..1, how much of the utterance was understood. Below ~0.5 the app may try the LLM. */
  confidence: number;
}

export type VoiceCommand = 'save' | 'repeat' | 'undo' | 'measure_height' | 'cancel' | 'new_tree' | 'photo';

/** Sync wire format. */
export interface SyncPushRequest {
  deviceId: string;
  events: TreeEvent[];
  blocks?: Block[];
}
export interface SyncPushResponse {
  accepted: string[]; // event ids stored (including ones already present)
  rejected: { id: string; reason: string }[];
}
export interface SyncPullResponse {
  events: TreeEvent[];
  blocks: Block[];
  scenarios: Scenario[];
  /** Opaque cursor to pass as ?since= next time. */
  cursor: string;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  /** Tag prefix owned by this user, e.g. "J". Unique across the account. */
  tagPrefix: string;
}
