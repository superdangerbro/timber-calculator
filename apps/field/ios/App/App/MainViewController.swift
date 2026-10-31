import UIKit
import Capacitor

/// Registers the app's own plugins (ios-plugins/TimberAI) with the Capacitor bridge.
/// Main.storyboard uses this class instead of the stock CAPBridgeViewController.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(TimberAIPlugin())
        bridge?.registerPluginInstance(TimberSpeechPlugin())
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }
}
