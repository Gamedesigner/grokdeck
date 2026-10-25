# iOS connection prototype

Project record: [GrokDeck — Project & Build Log](https://app.notion.com/p/404d9d2a6a048108b540e65f5c033920).

This is a native SwiftUI iPhone/iPad prototype, targeting iOS 18 or later. It reads the desktop cache through a separate, authenticated Node bridge. It does not read another iOS app's sandbox or authenticate directly to Grok Bot's backend.

## Run the bridge

From the repository on the Mac mini:

```sh
npm run bridge
```

The server binds **only** to `127.0.0.1:43872`. The first start generates a 256-bit pairing credential in `~/.grokdeck-bridge/pairing-token` with owner-only file permissions on macOS. The value is never logged. Copy it directly into the app's secure pairing field; do not put it in chat, Notion, Git, command arguments, or screenshots.

The iOS app stores a successfully verified pairing key in Keychain with device-only accessibility. Forgetting pairing clears this device's key; it does not rotate the host credential. To rotate the host key, stop the bridge, remove that credential file yourself, and start the bridge again. Re-pair clients afterward.

The default endpoint works only in an iOS simulator on the same Mac. **Physical iPhone access is not enabled by this prototype.** That requires a separately configured, reachable private HTTPS connection. No public listener, tunnel, firewall change, login item, or cloud relay is created.

## Build and test iOS

Use Xcode with an installed iOS simulator and XcodeGen. Keep a dedicated GrokDeck simulator; do not reuse the Duo or Little House devices.

```sh
cd ios
xcodegen generate
xcodebuild -project GrokDeck.xcodeproj -scheme GrokDeck \
  -destination 'platform=iOS Simulator,id=YOUR_GROKDECK_SIMULATOR_UUID' \
  -derivedDataPath "$HOME/Library/Developer/Xcode/DerivedData/GrokDeckPrototype" \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- test
```

Set `DEVELOPER_DIR` explicitly if the active command-line developer directory is not the intended Xcode. No global Xcode selection change is needed. Keep derived data outside synced Documents folders so Finder metadata does not break ad-hoc simulator signing. The Keychain pairing path is tested with normal local simulator signing, not an unsigned app.

After the Debug build, the helper can launch the app with local pairing on your explicitly selected simulator:

```sh
DEVELOPER_DIR=/Applications/Xcode-27.1.app/Contents/Developer \
  python3 scripts/launch-ios-prototype.py --device YOUR_GROKDECK_SIMULATOR_UUID
```

The helper reads the host's credential locally and passes it through the simulator's launch environment. It does not print the credential or put it in source/build resources. Debug-only environment pairing is excluded from Release builds. `--rejected-key` checks the authentication-error UI with a deliberately invalid test key.

## Read-only API v1

Every route requires `Authorization: Bearer <pairing-key>`. Keys in URLs are rejected. Requests from browser origins or foreign Host headers are rejected. The bridge provides no CORS access and accepts only GET requests.

- `GET /v1/health`: API version and read-only capability.
- `GET /v1/agents`: normalized active-account roster, section names, message counts, and cache metadata. Transcripts and host filesystem paths are omitted.
- `GET /v1/agents/{id}/messages`: cached entries for one agent from the active account. Unknown IDs return 404.

Missing/wrong keys return 401; unsupported methods return 405; an unavailable cache returns 503. Responses use `Cache-Control: no-store`. Oversized responses return 413. The iOS client refuses redirects so it cannot forward the credential to a redirected host.

## iOS interface and handoff

The prototype supports agent/result search, an attention filter, cached discussion viewing/search, foreground refresh, light/dark/system appearance, and preparing a draft for the system share sheet. Discussions stay in app memory rather than being copied into a new on-disk archive. Drafts in this prototype are temporary view state.

The Open in Grok Bot action uses the observed desktop route `grokbot://app/v1/agent?id=...`, checks whether iOS can open the scheme, and provides a sharing fallback. **Routing into an actual iOS Grok Bot conversation remains unverified.** A successful OS open alone would not prove the correct chat appeared.

On October 25, 2026, a development-signed Debug build was successfully built, installed, and launched on the connected physical iPhone running iOS 26.6.1. The device process inventory confirmed GrokDeck running. This verifies device deployment, not rendered UI, bridge connectivity, or routing into Grok Bot. Grok Bot is installed on that phone; no task, message, approval, or webhook was sent.

For another paired development device, generate the project and use its explicit device and signing team:

```sh
DEVELOPER_DIR=/Applications/Xcode-27.1.app/Contents/Developer \
  xcodebuild -project ios/GrokDeck.xcodeproj -scheme GrokDeck \
  -configuration Debug -destination 'id=YOUR_DEVICE_UDID' \
  -derivedDataPath "$HOME/Library/Developer/Xcode/DerivedData/GrokDeckDevice" \
  DEVELOPMENT_TEAM=YOUR_TEAM_ID -allowProvisioningUpdates \
  -allowProvisioningDeviceRegistration build
```

Install the resulting `Debug-iphoneos/GrokDeck.app` with Xcode or `xcrun devicectl device install app --device YOUR_DEVICE_UDID APP_PATH`. USB/developer pairing supports installation and debugging; it does not automatically make the Mac's loopback bridge reachable from an ordinary iOS app.

The desktop preview remains a separate app; the bridge is a development command, not an automatically enabled feature in its installer.
