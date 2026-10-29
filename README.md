# Timber Calculator

Offline-first, voice-driven tree tally for Interior BC timber cruising. Walk up to a tree,
talk ("big fir forty two, about thirty metres, straight four, no twist, clean"), the phone
fills the form, reads it back, and on "save" speaks a tag number (J-0147) for the flagging
tape. Every tree gets a GPS position, a pole-or-sawlog call and a dollar value. The office
dashboard puts it all on a map with filters, an editable table, and live value totals for
any area you draw, under prices you can change.

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

Prices, pole specs and volume coefficients are **placeholders** until confirmed. All of
them are editable as pricing scenarios in the dashboard, and pricing never changes field
measurements.
