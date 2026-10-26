# GrokDeck updates

GrokDeck 0.2.0 checks its private GitHub releases separately from Grok Bot's official release feed. Both checks run at launch and every six hours when the release-check preference is enabled. Settings exposes separate manual checks. A newer GrokDeck release appears as an update banner.

The updater uses a host-only `GROKDECK_GITHUB_TOKEN`, or an existing `gh auth login` session for github.com. It never bundles a token or sends it to the renderer or phone. No token is written to GrokDeck preferences. From 0.2.2, when no credential is available it checks for public releases without authentication, so a future public release will not require GitHub sign-in. This does not change repository visibility or expose private releases. Requests are restricted to Gamedesigner/grokdeck; renderer code cannot supply a feed or executable URL. Inaccessible private releases, missing metadata and network failures are unavailable, not up to date. Drafts and prereleases do not establish a current stable release.

Signed installed desktop builds can download through electron-updater and explicitly restart to install. Downloads are not automatic, installation on quit is disabled, and a restart is blocked while message delivery is unresolved. The renderer flushes pending preference saves before requesting a restart. Existing drafts remain in local preferences. Downgrades and web installers are disabled. Windows requires a configured publisher plus a valid matching signature on the running executable; macOS requires a non-ad-hoc TeamIdentifier signature. Download verification remains with electron-updater and the OS.

## Current distribution limitation

The current previews are unsigned and the private repository has no published stable updater release. These builds show manual downloads instead of offering installation. CI now retains `latest*.yml` alongside installers, ZIPs and blockmaps. Signing/notarization and publishing a stable release with its matching metadata are still required before end-to-end automatic installation can be verified. Never ship a GitHub token in app-update.yml or source. A Windows signed build must include its signing publisher in the generated updater configuration. No release is published automatically by CI.

### Signed Mac packaging

On a Mac with a Developer ID Application identity and a working notarytool
Keychain profile, set `GROKDECK_SIGNING_IDENTITY` to the certificate name and
`APPLE_KEYCHAIN_PROFILE` to the profile name, then run `npm run package:mac:signed`.
Use the full Xcode developer directory through `DEVELOPER_DIR` when needed.
The command builds both Mac architectures in `~/Library/Caches/GrokDeck/signed-release`, requires signing,
and asks electron-builder to notarize. It never publishes. The ordinary CI
packaging commands continue producing previews without requiring private keys.
Signed output stays outside Documents to avoid File Provider metadata that can
invalidate code signing while a build is running.

Before release, verify each app with `codesign --verify --deep --strict`,
`spctl --assess --type execute`, and `xcrun stapler validate`. Smoke-test the
Apple Silicon app on the Mac mini and the Intel app on a suitable machine.
Retain ZIPs, DMGs, blockmaps and `latest-mac.yml` together. A successful notarized
build is a prerequisite, not proof of the private updater's download/restart path.

This updates GrokDeck, not Grok Bot. Newly detected Grok Bot versions are never automatically added to the live-protocol allowlist: an app update must carry an explicitly reviewed adapter. Versions 0.75.0 and 0.75.8 are currently allowed; all other versions fail closed for live requests. Version changes invalidate gateway discovery cache. The bridge reports the detected source version rather than a fixed label.

The iPhone app is not replaced by the desktop updater. Its Mac-hosted bridge receives protocol fixes when the helper is restarted; native iOS app updates still require a device build or a future TestFlight distribution.

## Packaged bridge lifecycle

From 0.2.1, Connect live can launch the bridge bundled in the desktop installer. The helper uses the same app executable with a fixed internal mode; the renderer cannot provide executable paths, arguments or environment. Concurrent Connect requests coalesce, startup times out, and startup failures clean up owned children. Existing independent bridges are reused without taking ownership. The desktop app stops only its own helper on quit. LAN hosting is explicitly enabled in Settings and resumes on the selected address on app launch. Quick pairing copies a five-minute, single-use invitation through a native confirmation; the renderer never receives the bridge credential. The phone exchanges the invitation only over certificate-pinned HTTPS, then stores the returned pairing key in Keychain. Stopping hosting cancels invitations and disables automatic hosting on the next launch. Existing command-line proxies are not stopped.


### Phone pairing verification

The packaged Mac build started hosting at the selected private address and resumed it after app restart. A real Swift client using the app's PhoneSetup parser and BridgeClient exchanged a one-time setup and read the live roster over pinned HTTPS. The iOS simulator completed the native Paste → Use phone setup flow and displayed 52 live agents. Simulator testing required explicitly syncing the current Mac clipboard; stale clipboard invitations were correctly rejected. Physical-phone quick pairing still needs an unlocked-device check. The implementation generates certificates with the bundled selfsigned library; no OpenSSL executable is required on Mac or Windows. Automated tests cover certificate trust/SAN, rejected browser origins, single-use redemption, expiry and invalid endpoints.
