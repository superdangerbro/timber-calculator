# Timber Calculator: build spec

Offline-first, voice-driven tree tally for Interior BC. A cruiser walks up to a tree,
talks ("big fir forty-two, thirty metres, straight five, no twist, clean"), the phone
fills the form, reads it back, and on "save" speaks a tag number (e.g. "J-0147") that
goes on the flagging tape. The office dashboard is map-first: map on top, filters,
editable table below, polygon area totals with what-if pricing.

Main money question per tree: **pole or sawlog**.

## Repo layout (pnpm workspace)

| Path | What |
| --- | --- |
| `packages/core` (`@timber/core`) | Pure TS shared by both apps: types, voice parser, pole check, volume, value, tags, GPS averaging, clinometer math, hash-chained events, area math, exports. No DOM/Node-only APIs except WebCrypto (`globalThis.crypto.subtle`, present in Node 20+ and browsers). |
| `apps/web` (`@timber/web`) | Next.js 15 (App Router) on Vercel: auth, sync API, office dashboard. Postgres via Drizzle + `postgres` driver (Neon in prod, local Postgres 16 in dev at `postgres://timber:timber@localhost:5432/timber`). |
| `apps/field` (`@timber/field`) | Vite + React 19 + Capacitor 7 iPhone app. Runs in a desktop browser too (web fallbacks) so it can be tested headless. |

Import core as `import { ... } from '@timber/core'` (workspace dep, TS source, no build step).

## Core API (`packages/core/src/index.ts` is the contract)

Types are in `packages/core/src/types.ts`. Functions:

- `SPECIES: Species[]`, `speciesByCode(code)`, `speciesName(code)`. Interior BC list with aliases: FD (fir, doug, douglas fir, d fir), CW (cedar, red cedar), LW (larch, tamarack), PL (lodgepole, pine, lodge pole, PL), PY (ponderosa, yellow pine, bull pine), SX (spruce), BL (balsam, sub alpine fir, alpine fir), HW (hemlock), AT (aspen, poplar), EP (birch), AC (cottonwood). "fir" alone = FD.
- `parseUtterance(text: string): ParseResult` rule parser. Handles digits and spoken numbers ("forty-two", "forty two", "one hundred and five", "twenty eight point five"), units ("cm", "centimetres", "metres", "meters", "m", "feet" -> convert to m), DBH = first bare number or a number near "dbh/diameter/cm/inches" (inches -> cm); height = number followed by metres/m/feet or after "height/tall"; scales: "straight(ness) four", "straight, a four", "dead straight"=5, "twist two", "no twist"=5, "branchy/limby three", "branchiness 2", "clean"=5. Note score direction: 5 is always best, so "twist two" = 2 (bad), "no twist" = 5. Defects: phrases with rot, sweep, fork, crook, scar, conk, dead top, broken top, frost crack, catface -> `defects` free text (joined with "; "). "leave tree" -> leaveTree true. Commands: save / done / tag it -> save; repeat / say again -> repeat; undo / undo last / scratch that -> undo; measure height -> measure_height; cancel -> cancel; next tree / new tree -> new_tree. Corrections: "no, forty-four" -> the number replaces the most likely field (bare number 10-150 -> dbh). Return confidence = understood tokens / meaningful tokens.
- `mergeDraft(draft: TreeFields, fields: TreeFields): TreeFields` later wins; defects appended.
- `REQUIRED_FIELDS: (keyof TreeFields)[]` = species, dbhCm, heightM, straightness, twist, branchiness. `missingFields(draft)` returns those absent (leave trees only require species and dbh).
- `readbackText(draft: TreeFields): string` e.g. "Douglas-fir, 42 centimetres, 30 metres, straightness 4, twist 5, branchiness 3. Missing: twist." `tagSpeech(tag)` turns "J-0147" into "Tag J, zero one four seven." (spell digits so it is unambiguous over a saw).
- `formatTag(prefix: string, n: number, opts?: { blockCode?: string; leave?: boolean }): string` -> "J-0147", "CB12-J-0147", leave -> "J-L0003". 4 digits min. `nextTagNumber(existingNumbers: number[]): number` = max + 1 (never reuses voided numbers).
- `evaluatePole(t: TreeFields, spec: PoleSpec): PoleEvaluation` eligible when species in spec.species, heightM >= minLengthM, straightness/twist/branchiness >= mins, not a leave tree; poleClass = first of spec.classes with dbh >= minDbhCm and height >= minLengthM.
- `DEFAULT_VOLUME_COEFFICIENTS`, `treeVolumeM3(species, dbhCm, heightM, coeffs?)` Schumacher-Hall V = a·D^b·H^c. Placeholder coefficients so a 40 cm, 30 m fir is ~1.6-1.9 m³ (clearly flagged in code as placeholders until the BC taper equations are confirmed).
- `DEFAULT_SCENARIO: Scenario` ("Pole buyer prices") has `poleLengthTiers` = `POLE_BUYER_TIERS` (Joe's buyer, 2026-10-31: 35-40 ft $300/m³, 45-60 ft $340, 65 ft+ $500) and empty `sawlogPricePerM3` (by species, applied to net m³). `polePricePerM3` (by pole class) is only used when no length bands are set. Pole spec species FD, LW, PL, CW; minLength 10.66 m (35 ft); mins straight 4, twist 4, branch 3; classes Class 1 (dbh >= 40, len >= 18), Class 2 (>= 33, >= 15), Class 3 (>= 28, >= 13), Class 4 (>= 23, >= 10.66); `cards` = [`STELLA_JONES_CEDAR_2026`] for CW. defectDeduction 0.15. Legacy `polePrices` in stored scenarios is ignored.
- Pole length: card species (`longestPole`) take the Kozak taper, estimate over-bark diameter 6 ft above the 30 cm stump, use the largest card row met, and pick the longest listed cut length whose over-bark top meets the row's minimum top; sold length = cut − `trimFt` (3). Other species: `poleLengthFt(heightM)` = marketable height rounded down to 5 ft. The sold length picks the band (`poleTierFor`); no band -> sawlog. Card poles value the stump-to-pole-top piece at the band price and the rest to the marketable top (`topM3`) at the sawlog price.
- `TreeFields.poleFaults` (`damage`, `split`, `rot`, `barkSeam`, `knots`, `shake`, `sweep`): any one fails the pole check. The parser fills it from speech (`poleFaultsIn`), ignoring negated phrases ("no rot") and mild sweep.
- `valueTree(tree: Tree | (TreeFields & {id: string; voided?: boolean}), scenario): TreeValuation` voided or leave -> product none, value 0. Pole-eligible -> pole value (if pole value < sawlog value, still choose the higher and report that product). Missing species/dbh/height -> none.
- `summarize(trees, scenario): AreaSummary`.
- `averageFixes(fixes: GpsFix[]): AveragedPosition` inverse-variance weighted mean (weight 1/acc²), drop fixes with accuracy > 3x the best; accuracy = 1/sqrt(sum weights), floor 1 m.
- `heightFromAngles({ distanceM, topDeg, baseDeg }): number` = distance × (tan(top) − tan(base)), angles from horizontal, positive up. Rounded to 0.1 m.
- Events: `canonicalJson(obj)` stable key order; `hashEvent(e: Omit<TreeEvent,'hash'>): Promise<string>` sha-256 hex of canonicalJson; `makeEvent(input: { treeId, seq, type, payload, userId, deviceId, prevHash, createdAt? , id? }): Promise<TreeEvent>`; `verifyChain(events: TreeEvent[]): Promise<{ ok: boolean; brokenAt?: string }>` per deviceId ordered by createdAt then seq: each prevHash equals previous hash and each hash recomputes; `foldEvents(events of one tree): Tree | null`; `foldAll(events): Tree[]`.
- `treesInArea<T extends {lat:number; lon:number}>(trees: T[], polygon: GeoJSON.Polygon | GeoJSON.MultiPolygon): T[]`, `polygonAreaHa(polygon)`.
- `toCsv(trees: Tree[], scenario?: Scenario): string`, `toGeoJson(trees, scenario?): GeoJSON.FeatureCollection`, `toKml(trees, opts?: { name?: string; boundary?: GeoJSON.Polygon }): string`.
- `uuid()` v4 via crypto.randomUUID.

## Event model

All field data is append-only `TreeEvent`s, hash-chained per device (tamper evident). Edits in the dashboard are `update` events by the editing user (deviceId `web`); voids are `void` events. Sync = push events not yet on server, pull events since cursor. Server stores events (unique on id; idempotent) and a materialized `trees` table refreshed on write using `foldEvents`. Tag prefix is per user, so offline devices never collide.

## Server (apps/web)

- Postgres tables: users (id uuid, email unique, name, password_hash, tag_prefix unique, created_at), devices (id text, user_id, name, last_seen), sessions via signed JWT cookie (`jose`, secret `AUTH_SECRET`), events (all TreeEvent columns, payload jsonb, received_at, server_seq bigserial for cursors), trees (materialized Tree, lat/lon double precision), blocks (boundary jsonb), scenarios (data jsonb, created_by). Everything scoped to an `org`-less single account for now but every row carries user ids so multi-user works (all signed-in users see all data; good enough for a crew).
- Auth: `/signup`, `/login` pages; `POST /api/auth/signup|login|logout`; field app uses `POST /api/auth/token` returning a bearer token (same JWT) and sends `Authorization: Bearer`.
- Sync: `POST /api/sync/push` (SyncPushRequest), `GET /api/sync/pull?since=<cursor>` (SyncPullResponse). CORS allowed for the field app origins (`capacitor://localhost`, `http://localhost:*`).
- Other API: `GET/POST /api/scenarios`, `PUT /api/scenarios/:id`, `GET/POST /api/blocks`, `POST /api/trees/:id/events` (dashboard edits/voids/status), `GET /api/trees` (materialized), `GET /api/export?format=csv|geojson|kml&...`.
- Migrations: drizzle-kit generated SQL in `apps/web/drizzle/`, plus `pnpm --filter @timber/web db:migrate` and a `db:seed` script that creates user joe@example.com / password `timber123` prefix J, a block "CB12" polygon near Kamloops (approx 50.70N, -120.35W, ~25 ha), and ~120 realistic trees spread inside it (mix of FD, PL, LW, SX, CW, a few leave trees, a few voided), created through real hash-chained events.

## Maps

Joe wants Mapbox. Use **MapLibre GL JS** (open fork of Mapbox GL, same API) so it runs with or without a token, and pick the basemap at runtime:
- If `NEXT_PUBLIC_MAPBOX_TOKEN` / `VITE_MAPBOX_TOKEN` is set: Mapbox satellite-streets raster tiles (`https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/256/{z}/{x}/{y}@2x?access_token=...`) plus an outdoors option.
- Else: Esri World Imagery raster, with a fallback plain "no basemap" style (solid background + grid) that always renders. The sandbox we test in has NO internet tile access, so the map must look good with a blank background: trees, block boundary, labels must all be drawn from our own data.
Field app offline tiles: "Download map for this block" fetches raster tiles for the block bbox zoom 12-18 and stores them (Capacitor Filesystem on device, Cache Storage/IndexedDB on web), served via `maplibregl.addProtocol('offline', ...)`.

## Look and feel

Outdoor, high-contrast, glove-friendly. Dark forest-green chrome (#0f2a1d / #1b4332), safety-orange accent (#ff6b1a) for tags and primary actions, large type. Tag number on the field screen is huge (>= 72px). Species colours consistent across apps (define once in core as `SPECIES_COLORS`).
