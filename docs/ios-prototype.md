# iOS connection prototype

## Distribution preparation

The 0.2.2 build 2 release archive and App Store Connect distribution export
succeeded locally. The archived app has the expected version/build, compiled
opaque app icons, and all four iPad orientations. This verifies packaging only:
the package has not been uploaded to App Store Connect, processed by TestFlight,
or released. The current installed phone build is still the earlier developer
build. Local release outputs are outside Documents, under
`~/Library/Developer/Xcode/Archives/GrokDeck-0.2.2.xcarchive` and
`~/Library/Caches/GrokDeck/ios-distribution-0.2.2`.

Project record: [GrokDeck — Project & Build Log](https://app.notion.com/p/404d9d2a6a048108b540e65f5c033920).

This is a native SwiftUI iPhone/iPad prototype, targeting iOS 18 or later. It connects through a separate, authenticated Mac bridge. The default bridge reads the desktop cache; an experimental live bridge enables recent discussion reads, messaging and interruption. The iOS app does not read another app's sandbox or hold Grok Bot backend credentials.

## Run the bridge

From the repository on the Mac mini:

```sh
npm run bridge
```

The server binds **only** to `127.0.0.1:43872`. The first start generates a 256-bit pairing credential in `~/.grokdeck-bridge/pairing-token` with owner-only file permissions on macOS. The value is never logged. Copy it directly into the app's secure pairing field; do not put it in chat, Notion, Git, command arguments, or screenshots.

The iOS app stores a successfully verified pairing key in Keychain with device-only accessibility. Forgetting pairing clears this device's key; it does not rotate the host credential. To rotate the host key, stop the bridge, remove that credential file yourself, and start the bridge again. Re-pair clients afterward.

The default endpoint works only in an iOS simulator on the same Mac. Physical iPhone access is opt-in through the private HTTPS LAN proxy below. No public listener, tunnel, firewall change, login item, VPN, or cloud relay is created.

## Connect a physical iPhone over private Wi-Fi

Keep the phone and Mac on the same trusted private network. First run the ordinary loopback bridge, then start the HTTPS proxy in a separate terminal using one exact RFC1918 IPv4 address assigned to the Mac:

```sh
GROKDECK_LAN_HOST=YOUR_MAC_PRIVATE_IP node bridge/lan.mjs
```

The proxy refuses wildcard, public, loopback and unassigned addresses. It listens only on the selected interface/address on port 43873 and forwards authenticated native requests to the loopback bridge. It rejects browser origins and foreign Host headers. Stopping the command closes the LAN listener.

On first start it generates a 30-day self-signed TLS server certificate for that exact IP. The private key and certificate remain in `~/.grokdeck-bridge/tls-YOUR_MAC_PRIVATE_IP/` with owner-only permissions. The console shows the HTTPS endpoint and public certificate SHA-256 fingerprint. In the iPhone app's Settings, enter both values and the existing pairing key from the Mac's local credential file. Do not paste that key into chat, Notion, Git, shell arguments, or screenshots.

The app verifies the exact pinned leaf certificate, hostname/SAN, validity and signature. It does not install a system CA or disable TLS verification. A wrong/changed/expired certificate fails closed. A blank fingerprint uses normal system trust, so it cannot accept this self-signed LAN server. The pairing key is stored in Keychain only after a successful authenticated roster read; the public fingerprint is saved beside the endpoint in app preferences. A changed Mac IP or renewed certificate requires pairing with the new address/fingerprint. Remove an expired local TLS identity only after stopping the proxy, then restart and re-pair.

For a developer-launched Debug app, the existing token/URL launch environment additionally accepts `GROKDECK_BRIDGE_CERT_SHA256`. This fingerprint is public; keep the token in local process environment only. None of these debug variables is compiled into the app. Release builds require pairing through Settings.

After building a signed Debug device app, the helper loads the local token and certificate without putting the token in command arguments or output:

```sh
DEVELOPER_DIR=/Applications/Xcode-27.1.app/Contents/Developer \
  python3 scripts/launch-ios-device.py --device YOUR_PHYSICAL_DEVICE_UDID \
  --url https://YOUR_MAC_PRIVATE_IP:43873
```

It requires one explicit paired physical device and installs only GrokDeck. `--rejected-pin` checks the certificate rejection UI. Debug environment pairing is saved into Keychain and preferences only after authenticated health and roster reads succeed; a failed certificate/authentication check saves nothing. The simulator helper also accepts `--url https://YOUR_MAC_PRIVATE_IP:43873 --certificate /LOCAL/PATH/TO/cert.pem`.

For a bounded connection check, `GROKDECK_LAN_DIAGNOSTICS=1` enables method/status-only proxy logging, for example `Native bridge request: GET 200`. It never logs request URLs, agent IDs, credentials or response content. Leave it unset for normal use.

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

## Bridge API v1

Every route requires `Authorization: Bearer <pairing-key>`. Keys in URLs are rejected. Requests from browser origins or foreign Host headers are rejected. The bridge provides no CORS access. The default cache bridge accepts only GET requests.

- `GET /v1/health`: API version and read-only capability.
- `GET /v1/agents`: normalized active-account roster, section names, message counts, and cache metadata. Transcripts and host filesystem paths are omitted.
- `GET /v1/agents/{id}/messages`: cached entries for one agent from the active account. Unknown IDs return 404.

Missing/wrong keys return 401; unsupported methods return 405; an unavailable cache returns 503. Responses use `Cache-Control: no-store`. Oversized responses return 413. The iOS client refuses redirects so it cannot forward the credential to a redirected host.

The experimental live bridge reports `live: true` and `readOnly: false` from `/v1/health`, with `source.kind: "live-gateway"` in roster and discussion responses. Both are required before the iOS Send button is enabled. It adds only these explicit operations:

- `POST /v1/agents/{id}/send`: JSON `{ "prompt": "...", "clientNonce": "UUID" }`; response includes `apiVersion`, the same `clientNonce`, `accepted` (`true`, `false` or `null`), and `status` (`accepted`, `rejected` or `unknown`).
- `GET /v1/agents/{id}/sends/{clientNonce}`: check acceptance without resending.
- `POST /v1/agents/{id}/interrupt`: empty JSON object; request interruption of the current run.

The phone retains an unresolved send's original nonce and draft in memory, disables another send and offers an explicit status check. A timeout or lost response is shown as unconfirmed, never as proof that nothing was sent. It never retries a send automatically. Disconnecting or terminating the app clears these in-memory pending records, so check the official conversation before manually retyping an uncertain message after restarting.

## iOS interface and handoff

The prototype supports agent/result search, an attention filter, discussion viewing/search, foreground refresh, light/dark/system appearance, and preparing a draft for the system share sheet. Live mode adds an explicit message composer and Stop current run action. Recent messages refresh every two seconds while the discussion is foregrounded. Cache and live labels remain distinct; the live roster does not display fabricated discussion/message counts.

Opening a discussion starts at the latest message. Later polling preserves the reading position; Discussion actions → Jump to latest returns to the bottom. Discussions stay in app memory rather than being copied into a new on-disk archive. Drafts and pending send records are temporary app state.

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
