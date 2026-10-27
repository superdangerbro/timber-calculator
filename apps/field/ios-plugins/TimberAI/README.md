# TimberAI + TimberSpeech (custom iOS plugins)

Two small Capacitor 7 plugins that live in the app itself (no npm package):

| File | JS name | What it does |
| --- | --- | --- |
| `TimberAIPlugin.swift` | `TimberAI` | On-device LLM fallback using Apple **Foundation Models** (iOS 26+, Apple Intelligence). A `@Generable` `GeneratedTreeFields` struct makes the model return typed fields (species code, DBH cm, height m, 1-5 scores, defects, leave tree). Called only when the rule parser's confidence is below 0.5. |
| `TimberSpeechPlugin.swift` | `TimberSpeech` | `SFSpeechRecognizer` with `requiresOnDeviceRecognition` (works with no signal) and `contextualStrings` (species names, aliases and command words, so "larch", "balsam", "scratch that" are recognised reliably). Emits `partial` / `final` / `error` events. |

Both use the Capacitor 7 `CAPBridgedPlugin` style, so there is **no `.m` file**.
They are registered in `ios/App/App/MainViewController.swift`
(`bridge?.registerPluginInstance(...)`), and `Main.storyboard` uses that view
controller instead of the stock `CAPBridgeViewController`.

## Already wired up

`npx cap add ios` was run and the Xcode project (`ios/App/App.xcodeproj`)
already references these two files by relative path
(`../../ios-plugins/TimberAI/*.swift`), plus `MainViewController.swift`.
Opening `ios/App/App.xcworkspace` in Xcode should show them under **App**.

## If you ever regenerate `ios/` (or the files show red in Xcode)

1. In Xcode, right-click the **App** group > **Add Files to "App"...**
2. Pick `apps/field/ios-plugins/TimberAI/TimberAIPlugin.swift` and
   `TimberSpeechPlugin.swift`. Untick "Copy items if needed", tick target **App**.
3. Make sure `ios/App/App/MainViewController.swift` exists (copy it from git)
   and is in the App target.
4. In `ios/App/App/Base.lproj/Main.storyboard`, the view controller's custom class
   must be `MainViewController`, module `App` (Identity inspector).
5. Build. The JS side detects the plugins at runtime; without them the app
   falls back to `@capacitor-community/speech-recognition` and the rule parser only.

## Requirements and availability

- Foundation Models need **Xcode 26** (iOS 26 SDK) to compile the
  `#if canImport(FoundationModels)` branch. With an older Xcode the plugin still
  compiles and simply reports `available: false`.
- At runtime `SystemLanguageModel.default.availability` must be `.available`:
  iPhone 15 Pro or newer (the 17 Pro Max is fine), iOS 26+, Apple Intelligence
  turned on in Settings, model downloaded. Otherwise `availability()` returns
  `{ available: false, reason }` and the app keeps using the rule parser.
- On-device dictation: Settings > General > Keyboard > Dictation must be on, and
  the English (Canada or US) on-device model is downloaded the first time you use
  dictation with signal. The plugin falls back to en-US if en-CA has no
  on-device model.
- Info.plist already has `NSMicrophoneUsageDescription` and
  `NSSpeechRecognitionUsageDescription`.

These files cannot be compiled in the Linux sandbox they were written in;
expect to fix small Swift compiler nits on first build.
