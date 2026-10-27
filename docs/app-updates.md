# GrokDeck updates

## Current public previews

The repository is public. Public release checks and downloads do not require a GitHub token. Starting with **0.3.0-rc.5**, preview builds check newer preview and stable releases on GitHub; stable builds check stable releases only. Selection uses the installed platform, architecture, version, and required assets. An unavailable check is never reported as up to date.

Install 0.3.0-rc.5 manually once if you have an older preview. Afterwards, open **Settings → GrokDeck updates → Check GrokDeck updates**, choose **Download update**, and then **Install update** on Windows or **Restart and install** on Mac. The update banner also opens this section. Windows opens the normal installer; follow its steps to finish. Mac installs through its native signed-update mechanism. Checks run at launch and every six hours when enabled; downloading and installing remain explicit actions.

Windows previews are **unsigned** and Windows may show **Unknown publisher**. The updater checks the exact GitHub asset size and SHA-256 before opening the installer, and checks it again immediately before launch. This verifies the published download; it does not create a trusted Windows publisher identity. Mac release apps remain Developer ID signed and notarized. The iPhone app still requires an Xcode development install. See the [README](../README.md#download) for current links.

Downloads are restricted to the fixed Gamedesigner/grokdeck repository and approved GitHub asset hosts. Streams have byte and time limits. Mac downloads must match both the selected release asset's SHA-256 and the manifest's SHA-512, retain its minimum system version, and pass the native signing checks during installation. The renderer cannot provide a feed, executable URL, path, or command. No credentials or download paths are exposed to the renderer or phone.

Automatic installation on quit and downgrades are disabled. An unresolved desktop message blocks installation; new desktop sends are refused once installation begins. Preferences are saved before requesting installation. Finish phone activity before restarting its desktop helper. Preview releases must include the Windows EXE and, for each Mac architecture, the ZIP and DMG plus a matching **latest-mac.yml**. CI builds artifacts but does not publish releases automatically.

Public metadata is requested without authentication first. For a private repository response, the host can fall back to `GROKDECK_GITHUB_TOKEN` or an existing `gh auth login`; tokens stay in the main process, are not saved in preferences, and are not forwarded to asset-host redirects.

The sections below preserve historical updater validation; references to private 0.2.x releases describe the repository at that time.

## Updater implementation and history

GrokDeck 0.2.0 checks its private GitHub releases separately from Grok Bot's official release feed. Both checks run at launch and every six hours when the release-check preference is enabled. Settings exposes separate manual checks. A newer GrokDeck release appears as an update banner.

The updater uses a host-only `GROKDECK_GITHUB_TOKEN`, or an existing `gh auth login` session for github.com. It never bundles a token or sends it to the renderer or phone. No token is written to GrokDeck preferences. From 0.2.2, when no credential is available it checks for public releases without authentication, so public releases do not require GitHub sign-in. This does not change repository visibility or expose private releases. Requests are restricted to Gamedesigner/grokdeck; renderer code cannot supply a feed or executable URL. Inaccessible private releases, missing metadata and network failures are unavailable, not up to date. Drafts and prereleases do not establish a current stable release.

The earlier updater required a configured publisher plus a matching Windows executable signature. The 0.3.0-rc.5 Windows installer path replaces that requirement for the explicitly unsigned preview. Mac installation still requires a non-ad-hoc TeamIdentifier signature and retains electron-updater's native installation path.

## Historical 0.2.x validation

Mac 0.2.1 and 0.2.2 builds for Apple Silicon and Intel have passed Developer ID signing, notarization, Gatekeeper assessment, stapled-ticket validation, and packaged-app smoke tests. Their ZIP/DMG hashes match the updater metadata. Version 0.2.2 is published inside the private repository with 13 assets whose remote sizes and SHA-256 digests match local files. A real signed Apple Silicon 0.2.1 app downloaded this private release, installed 0.2.2, relaunched, passed signature/Gatekeeper checks, and reopened with a saved local draft intact. The test used a disposable app copy and profile, not the user's running app. An Intel baseline running under Rosetta also updated successfully to the native arm64 build; actual Intel hardware installation remains unverified. Windows previews remain unsigned and show manual downloads. CI retains `latest*.yml` alongside installers, ZIPs and blockmaps. Never ship a GitHub token in app-update.yml or source. A Windows signed build must include its signing publisher in the generated updater configuration. No release is published automatically by CI.

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

For a real Mac update integration test, set `GROKDECK_UPDATE_BASELINE` to an older
signed `.app` and `GROKDECK_UPDATE_EXPECTED` to the published target version,
then run `node scripts/update-install-smoke.mjs`. It copies the baseline into a
fresh cache folder and starts with a disposable profile. Squirrel's automatic
restart drops launch arguments and briefly uses the normal GrokDeck profile;
the test reports this, stops only its disposable executable, and reopens it with
the test profile. Updater caches are shared, so run without another update in
progress. The test calls the real release
check, download, and restart APIs, requires app replacement and relaunch, verifies
the resulting signature/Gatekeeper status, and reopens the updated app to check
that a local draft survived. It does not send bot messages or replace the user's
installed app. Its brief normal-profile relaunch may perform normal startup reads
or resume configured phone hosting. Test copies remain in the reported folder
for inspection.

This updates GrokDeck, not Grok Bot. Newly detected Grok Bot versions are never automatically added to the live-protocol allowlist: an app update must carry an explicitly reviewed adapter. Versions 0.75.0, 0.75.8, and 0.77.0 are currently allowed; all other versions fail closed for live requests. Version changes invalidate gateway discovery cache. See the [0.77.0 review](compatibility-0.77.0.md) for current evidence and limits.

The iPhone app is not replaced by the desktop updater. Its Mac-hosted bridge receives protocol fixes when the helper is restarted; native iOS app updates still require a device build or a future TestFlight distribution.

## Packaged bridge lifecycle

From 0.2.1, Connect live can launch the bridge bundled in the desktop installer. The helper uses the same app executable with a fixed internal mode; the renderer cannot provide executable paths, arguments or environment. Concurrent Connect requests coalesce, startup times out, and startup failures clean up owned children. Existing independent bridges are reused without taking ownership. The desktop app stops only its own helper on quit. LAN hosting is explicitly enabled in Settings and resumes on the selected address on app launch. Quick pairing copies a five-minute, single-use invitation through a native confirmation; the renderer never receives the bridge credential. The phone exchanges the invitation only over certificate-pinned HTTPS, then stores the returned pairing key in Keychain. Stopping hosting cancels invitations and disables automatic hosting on the next launch. Existing command-line proxies are not stopped.


### Phone pairing verification

The packaged Mac build started hosting at the selected private address and resumed it after app restart. A real Swift client using the app's PhoneSetup parser and BridgeClient exchanged a one-time setup and read the live roster over pinned HTTPS. The iOS simulator completed the native Paste → Use phone setup flow and displayed 52 live agents. Simulator testing required explicitly syncing the current Mac clipboard; stale clipboard invitations were correctly rejected. Physical-phone quick pairing still needs an unlocked-device check. The implementation generates certificates with the bundled selfsigned library; no OpenSSL executable is required on Mac or Windows. Automated tests cover certificate trust/SAN, rejected browser origins, single-use redemption, expiry and invalid endpoints.
