import type { Scenario, UnitSystem, UserProfile } from '@timber/core';

export interface Settings {
  deviceId: string;
  serverUrl: string;
  token: string | null;
  user: UserProfile | null;
  /** Account id last signed in on this phone; kept after sign-out so new events stay attributable. */
  lastUserId: string | null;
  /** Display name and tag prefix, editable offline before signing in. */
  userName: string;
  tagPrefix: string;
  /** Optional block code prepended to tags ("CB12-J-0147"). */
  blockCode: string;
  activeBlockId: string | null;
  /** Legacy (voice sessions always read back). */
  readback: boolean;
  /** Speak prompts and the tag number for button presses too (voice sessions always speak). */
  voicePrompts: boolean;
  ttsRate: number;
  /** Units for readback and display (storage is always metric). */
  units: UnitSystem;
  /** What a bare girth number means: circumference at breast height (taped) or DBH. */
  measure: 'circumference' | 'dbh';
  simulatedGps: boolean;
  autoSync: boolean;
  /** Latest scenario pulled from the server (pricing for running totals). */
  scenario: Scenario | null;
  /** Highest tag number ever handed out per "prefix:series" (belt and braces on top of the event log). */
  tagHighWater: Record<string, number>;
}

export function defaultSettings(deviceId: string): Settings {
  return {
    deviceId,
    serverUrl: (import.meta as any).env?.VITE_SERVER_URL ?? 'https://timber-calculator.vercel.app',
    token: null,
    user: null,
    lastUserId: null,
    userName: 'Joe',
    tagPrefix: 'J',
    blockCode: '',
    activeBlockId: null,
    readback: true,
    voicePrompts: false,
    ttsRate: 1,
    units: 'imperial',
    measure: 'circumference',
    simulatedGps: false,
    autoSync: true,
    scenario: null,
    tagHighWater: {},
  };
}
