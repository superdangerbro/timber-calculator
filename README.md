# Timber Calculator

Offline-first, voice-driven tree tally for Interior BC timber cruising. Walk up to a tree,
talk ("fir circumference seventy five inches, ninety eight feet, straight four, no twist, clean"),
the phone fills the form, works out DBH from the circumference, reads it back, and on "save"
speaks a tag number (J-0147) for the flagging tape. Say "take a photo" (or tap Photo) to attach
a picture. Every tree gets a GPS position, a volume and a pole-or-sawlog call. The office
dashboard puts it all on a map with filters, an editable table, and live totals for any area
you draw, plus dollar values once you enter your own $/m³.

| Part | Path | Stack |
| --- | --- | --- |
| Field app (iPhone) | [`apps/field`](apps/field/README.md) | Vite + React 19 + Capacitor 7, Apple on-device speech, Foundation Models fallback, SQLite, MapLibre with offline tiles |
| Office dashboard + sync API | [`apps/web`](apps/web) | Next.js 15 on Vercel, Postgres (Neon) via Drizzle, MapLibre, TanStack Table |
| Shared logic | [`packages/core`](packages/core) | Voice parser, pole check, volume, value, tags, hash-chained event log, exports |

The design and data model are in [`docs/SPEC.md`](docs/SPEC.md).

## Run it locally

Needs Node 20+, pnpm 10 and Postgres 16.

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local     # set DATABASE_URL and AUTH_SECRET
pnpm --filter @timber/web db:migrate
pnpm --filter @timber/web db:seed                # demo block CB12 + 120 trees; joe@example.com / timber123
pnpm dev:web                                     # http://localhost:3000
pnpm dev:field                                   # http://localhost:5173 (phone UI in the browser)
```

In the field app, open Settings, set the server to `http://localhost:3000` and sign in to sync.

## Tests

```bash
pnpm test                                        # core, web (needs timber_test DB) and field unit tests
node apps/web/e2e/smoke.mjs                      # dashboard walk-through (web running, freshly seeded)
node apps/field/e2e/session.mjs                  # full field session at iPhone size (field dev running)
node e2e/sync-integration.mjs                    # phone -> server -> dashboard -> phone round trip
```

## Deploy

- **Database:** create a Neon project, then run `DATABASE_URL=... pnpm --filter @timber/web db:migrate`.
- **Web:** import the repo into Vercel with root directory `apps/web`. Set `DATABASE_URL`,
  `AUTH_SECRET` (32+ random characters) and optionally `NEXT_PUBLIC_MAPBOX_TOKEN`.
- **iPhone:** build on a Mac with Xcode and install over a cable with a free Apple ID
  (re-run from Xcode every 7 days); see
  [`apps/field/README.md`](apps/field/README.md).

## How the data works

Field data is never edited in place. Every save, edit, void and audit status is an
append-only event, hash-chained per device, so any after-the-fact change is detectable
(the dashboard shows "chain verified" per tree). Each person owns a tag prefix, so phones
working offline do not hand out the same numbers. If a clash does happen (for example,
tallying before the first sign-in), the phone flags it and offers a one-tap re-tag, and
the dashboard marks the duplicate.

**Measuring.** The field app defaults to circumference in imperial units (Settings >
Measuring switches to DBH and/or metric). Units only change what is shown and read back:
everything is stored metric (`circumference_cm`, `dbh_cm` = C / pi, `height_m`), and DBH can
still be spoken directly.

**Pricing.** All prices are $/m³. The default scenario, "Pole buyer prices", carries Joe's
pole buyer's prices by pole length ($300 for 35-40 ft, $340 for 45-60 ft, $500 for 65 ft and up)
and no sawlog prices until you enter them per species. Both are editable on the phone
(Settings > Prices) and on the dashboard (What-if pricing). Pole length for western redcedar
comes from the Stella-Jones red cedar card (July 2026): the BC Kozak taper equation estimates
the diameter 6 ft up from the butt (over bark) from DBH and marketable height, the tree uses the
card row it meets, and makes the longest listed length whose top is at least that row's minimum
top. The sold length (cut length − 3 ft trim, editable) picks the $/m³ band; the pole piece is
valued at that band and the rest of the stem to the marketable top at the sawlog $/m³. Other
pole species use marketable height rounded down to 5 ft. A tree too short for every band, or
with any pole fault ticked (damage over 1", splits, rot, bark seams over 2", spike knots/burls,
shake, excess sweep), is valued as sawlog. Pricing never changes field measurements.

**Photos.** Photos are shrunk on the phone to about 1280 px JPEG (under 250 KB), kept offline,
and uploaded on sync to `PUT /api/photos/:id` (sha-256 checked, idempotent). The tree's event
log records each photo's id and hash. The server keeps the bytes in a Postgres `bytea` table,
which is fine for a few thousand photos; for production volume swap `apps/web/src/lib/server/photos.ts`
to Vercel Blob or S3 and keep the same API.
