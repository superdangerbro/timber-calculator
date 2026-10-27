import Foundation
import AVFoundation
import Speech
import Capacitor

// On-device speech recogniser for the tally loop.
//
// Why not only @capacitor-community/speech-recognition? It cannot pass
// contextualStrings (species names, command words) and does not force
// on-device recognition, which is what makes dictation work with no signal.
//
// JS side: src/platform/speech.native.ts -> registerPlugin('TimberSpeech')
//   requestPermissions(): { speech, microphone }   ("granted" | "denied" | "prompt")
//   start({ language, contextualStrings, onDevice }): void
//   stop(): void
//   events: "partial" { text }, "final" { text }, "error" { message }
//
// End-of-utterance is decided on the JS side (1.4 s of silence after the last
// partial result) so the cruiser never has to press anything.

@objc(TimberSpeechPlugin)
public class TimberSpeechPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TimberSpeechPlugin"
    public let jsName = "TimberSpeech"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
    ]

    private let audioEngine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var recognizer: SFSpeechRecognizer?

    @objc override public func requestPermissions(_ call: CAPPluginCall) {
        SFSpeechRecognizer.requestAuthorization { status in
            let speech: String
            switch status {
            case .authorized: speech = "granted"
            case .notDetermined: speech = "prompt"
            default: speech = "denied"
            }
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                call.resolve(["speech": speech, "microphone": granted ? "granted" : "denied"])
            }
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        let language = call.getString("language") ?? "en-CA"
        let contextual = call.getArray("contextualStrings", String.self) ?? []
        let onDevice = call.getBool("onDevice") ?? true

        DispatchQueue.main.async {
            self.stopInternal()
            guard SFSpeechRecognizer.authorizationStatus() == .authorized else {
                call.reject("Speech recognition not authorised")
                return
            }
            // en-CA supports on-device recognition on current iPhones; fall back to en-US.
            var rec = SFSpeechRecognizer(locale: Locale(identifier: language))
            if rec == nil || (onDevice && rec?.supportsOnDeviceRecognition == false) {
                rec = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
            }
            guard let recognizer = rec, recognizer.isAvailable else {
                call.reject("Speech recogniser not available")
                return
            }
            self.recognizer = recognizer

            do {
                let session = AVAudioSession.sharedInstance()
                try session.setCategory(.playAndRecord, mode: .measurement,
                                        options: [.duckOthers, .defaultToSpeaker, .allowBluetooth, .allowBluetoothA2DP])
                try session.setActive(true, options: .notifyOthersOnDeactivation)

                let req = SFSpeechAudioBufferRecognitionRequest()
                req.shouldReportPartialResults = true
                req.contextualStrings = contextual
                req.taskHint = .dictation
                if onDevice && recognizer.supportsOnDeviceRecognition {
                    req.requiresOnDeviceRecognition = true
                }
                if #available(iOS 16.0, *) {
                    req.addsPunctuation = false
                }
                self.request = req

                let input = self.audioEngine.inputNode
                let format = input.outputFormat(forBus: 0)
                input.removeTap(onBus: 0)
                input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
                    req.append(buffer)
                }
                self.audioEngine.prepare()
                try self.audioEngine.start()

                self.task = recognizer.recognitionTask(with: req) { [weak self] result, error in
                    guard let self = self else { return }
                    if let result = result {
                        let text = result.bestTranscription.formattedString
                        if result.isFinal {
                            self.notifyListeners("final", data: ["text": text])
                            DispatchQueue.main.async { self.stopInternal() }
                        } else {
                            self.notifyListeners("partial", data: ["text": text])
                        }
                    }
                    if let error = error as NSError? {
                        // 1110 = no speech detected; 216/301 = cancelled. Not worth surfacing.
                        if ![1110, 216, 301].contains(error.code) {
                            self.notifyListeners("error", data: ["message": error.localizedDescription])
                        }
                        DispatchQueue.main.async { self.stopInternal() }
                    }
                }
                call.resolve()
            } catch {
                self.stopInternal()
                call.reject("Could not start audio: \(error.localizedDescription)")
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.stopInternal()
            call.resolve()
        }
    }

    private func stopInternal() {
        if audioEngine.isRunning {
            audioEngine.stop()
        }
        audioEngine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.cancel()
        request = nil
        task = nil
        // Hand the audio session back so text-to-speech is loud and clear.
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
