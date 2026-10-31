import Foundation
import Capacitor
#if canImport(FoundationModels)
import FoundationModels
#endif

// On-device LLM fallback for the voice tally (Apple Foundation Models, iOS 26+).
//
// JS side: src/platform/interpreter.ts -> registerPlugin('TimberAI')
//   availability(): { available: boolean, reason?: string }
//   interpret({ text, draft }): { fields: TreeFields | null }
//
// Used only when the rule parser's confidence is < 0.5. Runs fully on device,
// so it works with no cell signal. On older iPhones / iOS, or with Apple
// Intelligence turned off, availability() returns false and the app simply
// keeps the rule-parser result.

#if canImport(FoundationModels)
@available(iOS 26.0, *)
@Generable(description: "Measurements of one standing tree, as spoken by a timber cruiser")
struct GeneratedTreeFields {
    @Guide(description: "BC species code, exactly one of FD (Douglas-fir), CW (western redcedar), LW (western larch), PL (lodgepole pine), PY (ponderosa pine), SX (spruce), BL (subalpine fir / balsam), HW (hemlock), AT (aspen), EP (birch), AC (cottonwood). Omit if no species was said.")
    var species: String?

    @Guide(description: "Diameter at breast height in centimetres. Convert inches to cm (x 2.54).", .range(5.0...250.0))
    var dbhCm: Double?

    @Guide(description: "Merchantable height in metres. Convert feet to metres (x 0.3048).", .range(1.0...80.0))
    var heightM: Double?

    @Guide(description: "Stem straightness score 1-5, 5 = dead straight.", .range(1...5))
    var straightness: Int?

    @Guide(description: "Twist score 1-5, 5 = no twist at all, 1 = severe twist.", .range(1...5))
    var twist: Int?

    @Guide(description: "Branchiness score 1-5, 5 = clean / no limbs, 1 = very limby.", .range(1...5))
    var branchiness: Int?

    @Guide(description: "Defects mentioned (rot, sweep, fork, crook, scar, conk, dead top, broken top, frost crack, catface), joined with '; '. Omit if none.")
    var defects: String?

    @Guide(description: "True only if the cruiser said this is a leave tree / wildlife tree to keep.")
    var leaveTree: Bool?
}
#endif

@objc(TimberAIPlugin)
public class TimberAIPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TimberAIPlugin"
    public let jsName = "TimberAI"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "availability", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "interpret", returnType: CAPPluginReturnPromise),
    ]

    private static let instructions = """
    You turn a timber cruiser's short spoken note about one tree in the Interior of \
    British Columbia into structured fields. Speech recognition may mishear words \
    ("for" may mean "four", "doug" means Douglas-fir, "fir" alone means Douglas-fir). \
    All scores are 1 to 5 where 5 is always best: "no twist" is twist 5, "dead straight" \
    is straightness 5, "clean" is branchiness 5. Only fill a field when the note actually \
    states it; never guess or copy values from the current draft. Corrections like \
    "no, forty four" replace the most likely field (a bare number 10-150 is DBH).
    """

    @objc func availability(_ call: CAPPluginCall) {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            switch SystemLanguageModel.default.availability {
            case .available:
                call.resolve(["available": true])
            case .unavailable(let reason):
                call.resolve(["available": false, "reason": String(describing: reason)])
            @unknown default:
                call.resolve(["available": false, "reason": "unknown"])
            }
            return
        }
        #endif
        call.resolve(["available": false, "reason": "Requires iOS 26 with Apple Intelligence"])
    }

    @objc func interpret(_ call: CAPPluginCall) {
        guard let text = call.getString("text"), !text.isEmpty else {
            call.reject("text is required")
            return
        }
        let draft = call.getObject("draft") ?? [:]

        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            guard case .available = SystemLanguageModel.default.availability else {
                call.resolve(["fields": NSNull()])
                return
            }
            Task {
                do {
                    let session = LanguageModelSession(instructions: Instructions(Self.instructions))
                    let draftJson = (try? JSONSerialization.data(withJSONObject: draft, options: [.sortedKeys]))
                        .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
                    let prompt = "Current draft (for context only): \(draftJson)\nCruiser said: \"\(text)\""
                    let response = try await session.respond(
                        to: prompt,
                        generating: GeneratedTreeFields.self,
                        options: GenerationOptions(temperature: 0)
                    )
                    call.resolve(["fields": Self.toJS(response.content)])
                } catch {
                    // Guardrail or context errors: fall back to the rule parser silently.
                    call.resolve(["fields": NSNull(), "error": error.localizedDescription])
                }
            }
            return
        }
        #endif
        call.resolve(["fields": NSNull()])
    }

    #if canImport(FoundationModels)
    @available(iOS 26.0, *)
    private static func toJS(_ f: GeneratedTreeFields) -> [String: Any] {
        var out: [String: Any] = [:]
        if let v = f.species?.uppercased(), !v.isEmpty { out["species"] = v }
        if let v = f.dbhCm { out["dbhCm"] = v }
        if let v = f.heightM { out["heightM"] = v }
        if let v = f.straightness { out["straightness"] = v }
        if let v = f.twist { out["twist"] = v }
        if let v = f.branchiness { out["branchiness"] = v }
        if let v = f.defects, !v.isEmpty { out["defects"] = v }
        if let v = f.leaveTree, v { out["leaveTree"] = true }
        return out
    }
    #endif
}
