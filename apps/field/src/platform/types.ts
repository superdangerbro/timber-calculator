// Platform abstraction. Each capability has a native (Capacitor plugin) and a
// web implementation; src/platform/index.ts picks one at startup. Everything
// above this layer (tally machine, screens, sync) only sees these interfaces,
// which is what makes the app testable headless.
import type { Block, GpsFix, TreeEvent, TreeFields } from '@timber/core';

export type SpeechKind = 'native' | 'web' | 'text';

export interface ListenHandlers {
  /** Interim transcript while the user is still talking. */
  onPartial?(text: string): void;
  /** Final transcript of one utterance. */
  onFinal(text: string): void;
  /** Listening stopped (after a final result, an error or stop()). */
  onEnd?(): void;
  onError?(message: string): void;
}

export interface SpeechEngine {
  readonly kind: SpeechKind;
  /** Ask for microphone / speech permission. Resolves false if denied. */
  requestPermission(): Promise<boolean>;
  start(handlers: ListenHandlers, contextualStrings: string[]): Promise<void>;
  stop(): Promise<void>;
  isListening(): boolean;
  /** Typed-transcript fallback ("type what you'd say"). Every engine accepts it. */
  submitText(text: string): void;
}

export interface TtsEngine {
  /** Speaks and resolves when finished (or after a safety timeout). */
  speak(text: string, opts?: { rate?: number }): Promise<void>;
  stop(): Promise<void>;
}

export interface GpsWatch {
  stop(): void;
}

export interface GpsEngine {
  readonly kind: 'native' | 'web' | 'simulated';
  watch(onFix: (fix: GpsFix) => void, onError?: (message: string) => void): Promise<GpsWatch>;
}

export interface Orientation {
  /** Degrees above the horizon the back camera points at (positive = up). */
  pitchDeg: number;
  /** Compass heading in degrees (0 = north) if known. */
  headingDeg: number | null;
}

export interface MotionEngine {
  readonly kind: 'native' | 'web';
  start(onOrientation: (o: Orientation) => void): Promise<() => void>;
}

export interface StoredEvent {
  event: TreeEvent;
  synced: boolean;
}

export interface TileRegion {
  id: string;
  name: string;
  bbox: [number, number, number, number]; // west, south, east, north
  minZoom: number;
  maxZoom: number;
  tileCount: number;
  bytes: number;
  source: string;
  createdAt: string;
}

/** Local persistence: events, blocks, settings, offline tile index, sync cursor. */
export interface LocalStore {
  init(): Promise<void>;
  /** Idempotent by event id. Existing events keep their synced flag unless `synced` is true. */
  putEvents(events: TreeEvent[], synced: boolean): Promise<void>;
  allEvents(): Promise<StoredEvent[]>;
  /** Overwrite events by id (unsynced). Only for re-signing never-pushed local events. */
  replaceEvents(events: TreeEvent[]): Promise<void>;
  unsyncedEvents(): Promise<TreeEvent[]>;
  markSynced(ids: string[]): Promise<void>;
  getBlocks(): Promise<Block[]>;
  putBlock(block: Block): Promise<void>;
  deleteBlock(id: string): Promise<void>;
  getSetting<T>(key: string): Promise<T | undefined>;
  setSetting<T>(key: string, value: T): Promise<void>;
  // Offline map tiles.
  getRegions(): Promise<TileRegion[]>;
  putRegion(region: TileRegion): Promise<void>;
  deleteRegion(id: string): Promise<void>;
  putTile(regionId: string, key: string, data: ArrayBuffer): Promise<void>;
  getTile(key: string): Promise<ArrayBuffer | undefined>;
}

/** On-device LLM fallback for utterances the rule parser does not understand. */
export interface Interpreter {
  readonly available: boolean;
  interpret(text: string, draft: TreeFields): Promise<TreeFields | null>;
}

export interface Platform {
  native: boolean;
  speech: SpeechEngine;
  tts: TtsEngine;
  gps: GpsEngine;
  motion: MotionEngine;
  store: LocalStore;
  interpreter: Interpreter;
}
