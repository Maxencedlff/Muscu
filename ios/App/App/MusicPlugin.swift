import Foundation
import UIKit
import Capacitor
import MediaPlayer

/// Apple Music pendant la séance : morceau en cours (titre, artiste, pochette) et commandes
/// lecture / pause / suivant / précédent sur le lecteur de l'app Musique.
/// Côté web : Capacitor.registerPlugin('MdlfMusic'), événement « change » à chaque changement.
@objc(MusicPlugin)
public class MusicPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MusicPlugin"
    public let jsName = "MdlfMusic"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "nowPlaying", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "next", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "previous", returnType: CAPPluginReturnPromise),
    ]

    private let player = MPMusicPlayerController.systemMusicPlayer
    private var observing = false

    @objc func requestAuthorization(_ call: CAPPluginCall) {
        MPMediaLibrary.requestAuthorization { status in
            let granted = status == .authorized
            if granted { DispatchQueue.main.async { self.startObserving() } }
            call.resolve(["granted": granted])
        }
    }

    @objc func nowPlaying(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard MPMediaLibrary.authorizationStatus() == .authorized else {
                call.resolve(["authorized": false]); return
            }
            self.startObserving()
            call.resolve(self.state())
        }
    }

    @objc func play(_ call: CAPPluginCall)     { command(call) { $0.play() } }
    @objc func pause(_ call: CAPPluginCall)    { command(call) { $0.pause() } }
    @objc func next(_ call: CAPPluginCall)     { command(call) { $0.skipToNextItem() } }
    @objc func previous(_ call: CAPPluginCall) { command(call) { $0.skipToPreviousItem() } }

    private func command(_ call: CAPPluginCall, _ action: @escaping (MPMusicPlayerController) -> Void) {
        DispatchQueue.main.async {
            guard MPMediaLibrary.authorizationStatus() == .authorized else {
                call.reject("Accès à Apple Music non autorisé"); return
            }
            action(self.player)
            call.resolve(self.state())
        }
    }

    /// État courant : titre, artiste, pochette (JPEG base64, 120 px), lecture en cours ou non
    private func state() -> [String: Any] {
        var out: [String: Any] = [
            "authorized": true,
            "playing": player.playbackState == .playing,
        ]
        if let item = player.nowPlayingItem {
            out["title"] = item.title ?? ""
            out["artist"] = item.artist ?? ""
            if let image = item.artwork?.image(at: CGSize(width: 120, height: 120)),
               let jpeg = image.jpegData(compressionQuality: 0.7) {
                out["artwork"] = "data:image/jpeg;base64," + jpeg.base64EncodedString()
            }
        }
        return out
    }

    private func startObserving() {
        guard !observing else { return }
        observing = true
        player.beginGeneratingPlaybackNotifications()
        let center = NotificationCenter.default
        for name in [Notification.Name.MPMusicPlayerControllerNowPlayingItemDidChange,
                     Notification.Name.MPMusicPlayerControllerPlaybackStateDidChange] {
            center.addObserver(forName: name, object: player, queue: .main) { [weak self] _ in
                guard let self = self else { return }
                self.notifyListeners("change", data: self.state())
            }
        }
    }

    deinit {
        if observing { player.endGeneratingPlaybackNotifications() }
    }
}
