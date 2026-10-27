# Timber Tally: the field app (`@timber/field`)

An offline-first, voice-driven tree tally for iPhone (built for an iPhone 17 Pro Max),
made with Vite, React 19, TypeScript and Capacitor 7. The same code runs in a desktop
browser, using web fallbacks, so it can be developed and tested without a phone.

## The tally loop (10-15 s per tree, no taps)

1. Press **Talk**, press a Bluetooth clicker, or hold Talk. GPS averaging starts right away.
2. Talk casually: "big fir forty two, about thirty metres, straight four, no twist, clean".
3. The form fills in. The phone reads the tree back, including anything still missing,
   and then listens again for answers or corrections ("no, forty four").
4. Say **"save"** or press the clicker. The tag (for example **J-0147**) is spoken digit by
   digit and shown in huge orange text, ready to write on the flagging tape.
5. Other commands: "repeat" says the tag again; "undo" voids the last tree (its number is
   never reused); "measure height" opens the clinometer; "next tree" or "cancel" start over;
   "leave tree" gives the tree a tag in the L series (J-L0003).

Clicker: anything that sends Space, Enter, the up or down arrow, or Play/Pause works.
Most camera-shutter remotes have a keyboard mode for this. iOS does not pass the volume
buttons to apps, so a remote that only sends Volume Up will not work.
What one press does depends on the state: idle starts listening, listening means "I'm done
talking", during readback it saves, and after a save it starts the next tree.

## Run it on a computer

```bash
pnpm install
pnpm --filter @timber/field dev            # http://localhost:5173
pnpm --filter @timber/field test           # vitest: tally state machine, tags, storage, sync
pnpm --filter @timber/field build          # type-check + production bundle in dist/
node apps/field/e2e/session.mjs            # full Playwright session (dev server must be running)
```

URL switches for desktop testing:
- `?speech=text` shows the typed box instead of the browser microphone.
- `?tts=silent` turns spoken output off; the text still shows on screen.
- `?notch=1` draws the Dynamic Island and the home indicator.
- `?tab=trees` opens a given tab.

Settings has a **Simulated GPS** switch that walks around block CB12.

Environment variables (optional, in `apps/field/.env`):
- `VITE_SERVER_URL`: the default server. It can also be changed in Settings.
- `VITE_MAPBOX_TOKEN`: if set, uses Mapbox satellite imagery. Without it, the app uses Esri World Imagery.

## Build to Joe's iPhone

You need a Mac with **Xcode 26** (for Apple Intelligence; Xcode 16 also builds, but without
the AI fallback), CocoaPods (`brew install cocoapods`), Node 20+ and pnpm, plus an Apple
Developer account ($99 a year) for TestFlight.

```bash
git clone <repo> && cd timber-calculator
pnpm install
pnpm --filter @timber/field build          # web bundle -> apps/field/dist
cd apps/field
npx cap sync ios                           # copies dist into ios/ and runs pod install
npx cap open ios                           # opens ios/App/App.xcworkspace in Xcode
```

### Run on the phone over a cable (quickest)

1. In Xcode, select the **App** target, open **Signing & Capabilities**, choose your Team and
   keep the bundle id `ca.humanesolutions.timber`, or make it unique.
2. Plug in the iPhone, trust the Mac, and turn on **Developer Mode** on the phone
   (Settings > Privacy & Security). Pick the phone as the run destination and press Run (Cmd-R).
3. On first launch, allow Microphone, Speech Recognition, Location (While Using) and Motion.
   The clinometer screen has an "Enable tilt sensor" button if iOS has not asked yet.

### TestFlight (installs without a cable, and updates)

1. In App Store Connect, create the app with the same bundle id.
2. In Xcode, set the run destination to **Any iOS Device (arm64)**, choose **Product > Archive**,
   then **Distribute App > App Store Connect > Upload**.
3. In App Store Connect > TestFlight, add Joe as an internal tester. He installs the
   **TestFlight** app and accepts the invite.
4. For each update, run `pnpm --filter @timber/field build && npx cap sync ios`,
   increase the Build number in Xcode, and archive again.

### Before going to the bush

- Settings > General > Keyboard > **Enable Dictation** on, and use dictation once with
  signal so iOS downloads the on-device English model. Recognition then works offline.
- Settings > **Apple Intelligence** on (iPhone 15 Pro or newer, iOS 26). This enables the AI
  fallback for unusual phrasing. Without it, the built-in rule parser does all the work.
- In the app: sign in once (Settings > Account), open **Maps**, and download each block's
  imagery (zoom 12-17) while you have signal.

## How it is put together

```
src/
  platform/        interfaces + native (Capacitor) / web implementations, picked in platform/index.ts
    speech*.ts     TimberSpeech plugin (on-device, contextual strings) -> community plugin -> Web Speech -> typed box
    tts.ts         @capacitor-community/text-to-speech | speechSynthesis (with timeouts) | silent
    gps.ts         @capacitor/geolocation | navigator.geolocation | SimulatedGps
    motion.ts      @capacitor/motion / DeviceOrientation -> camera pitch (beta - 90)
    storage.*.ts   SQLite (@capacitor-community/sqlite + Filesystem tiles) | IndexedDB (idb)
    interpreter.ts TimberAI (Foundation Models) LLM fallback | null
  state/
    repo.ts        hash-chained event log (makeEvent/foldAll), tag allocation, settings
    tally.ts       the voice state machine (idle/listening/thinking/readback/saved)
    gps.ts         live position + per-tree averaging (averageFixes)
  sync/client.ts   POST /api/auth/token, POST /api/sync/push, GET /api/sync/pull?since=
  map/             MapLibre map (works with no tiles), offline:// tile protocol, tile downloads
  screens/         Tally, Measure (clinometer), Trees, Audit, Maps, Settings
ios-plugins/TimberAI/  Swift: TimberAIPlugin (Foundation Models @Generable) + TimberSpeechPlugin
ios/               Capacitor iOS project (Info.plist usage strings, MainViewController registers plugins)
e2e/session.mjs    Playwright end-to-end session at 440x956
```

Data rules:
- Every change is an append-only `TreeEvent` (create, update, void or status), hash-chained
  per device and written to local storage before anything else happens.
- Tag numbers come from `nextTagNumber` over every tree with your prefix, voided trees
  included. A high-water mark is also kept in settings, so a number is never reused, even
  after an undo or a restart.
- Trees tallied before the first sign-in are re-signed to your account at sign-in. They
  never left the phone, so this is safe, and the server accepts them.
- Sync runs every 60 s while signed in and online, and when the connection comes back.
  Both push and pull are idempotent.

## What only works on the phone

These cannot run in a desktop browser or CI:
- On-device speech recognition
- Foundation Models
- The native SQLite and Filesystem storage
- The real tilt sensor
- The camera behind the clinometer crosshair

The web build swaps in the typed box, IndexedDB and a tilt slider for these.
