# GrokDeck

Your Grok Bot agents, conversations, and computers in one workspace—on Mac, Windows, and iPhone.

**GrokDeck by [Ron Millar](https://ronmillar.com) 2026.** Independent, MIT-licensed software. Bring your own Grok Bot account; no shared account or hosted GrokDeck service is required.

## Start here

1. Install Grok Bot on your Mac or Windows PC and sign in to **your own account**.
2. Install GrokDeck on the same computer. It connects live automatically and retries if interrupted.
3. For iPhone, keep the desktop app running. In desktop Settings, choose your trusted network, start the phone connection, and copy the one-time setup.
4. In iPhone GrokDeck Settings, paste that setup into Quick pairing within five minutes. Your agents appear after the connection is verified.

Use the same trusted local network. Each person runs their own helper; the desktop app includes it. No Grok Bot password is entered into GrokDeck. The phone gets its own pairing credential, not your Grok Bot session.

**Preview availability:** Mac live connection and physical iPhone viewing, touch, and typing are tested. Windows live account access still needs physical-device verification. iOS currently requires an Xcode development install; there is no public TestFlight/App Store download yet. See [iOS build instructions](docs/ios-prototype.md).

## Current preview

- Reads the **real local Grok Bot cache**: agents, sections, unread markers, and cached conversation history.
- Search names, results, and discussion text; reopen conversations through Grok Bot's agent deep link.
- Pin agents, keep private notes, save follow-up drafts, and mark items reviewed locally.
- Export an individual cached discussion as Markdown.
- Customize dark/light/system appearance, accent color, text size, and density.
- Detect the locally running Grok Bot version and warn when it differs from the tested adapter version.
- Check the official stable release feed on launch and every six hours, with a manual check and an option to disable background checks.
- Explicitly labeled example workspace for exploring the interface without local data.

**Modes:** The default desktop view reads the local cache. The experimental live bridge supports current discussions, sending text and replies with emoji, checking delivery, requesting a run interruption, provided bot pictures, and per-bot computer status with an iPhone remote viewer. The desktop connects automatically and starts its bundled local bridge when needed. Replies refresh every two seconds while the discussion is visible. This is version-specific integration verified against Grok Bot 0.75.0, with 0.75.8 protocol review and Mac live-read verification, not a documented public API. Approvals, attachments, and richer actions still use Grok Bot. GrokDeck never modifies its cache or installs Grok Bot updates.

## Download the preview

Download the latest Mac or Windows installer from [releases](https://github.com/Gamedesigner/grokdeck/releases/latest). On a Mac, choose the arm64 DMG for Apple Silicon or x64 DMG for Intel; open it and drag GrokDeck into Applications. Windows has an x64 installer and portable ZIP. Open Grok Bot and sign in, then launch GrokDeck; GrokDeck connects automatically. The desktop installer includes the bridge; no Node.js checkout or terminal command is needed. Allow OS secure-storage access if prompted. Keep GrokDeck open while using a bridge it started. Independently started development bridges are reused and are not stopped when GrokDeck quits.

Mac signing, notarization and a real private self-update are verified. Windows signing and broadly available iPhone distribution are still being prepared. To pair an iPhone, open desktop Settings → Connect your iPhone, select your private network address, start the connection, and copy phone setup. Paste it into iPhone Settings → Quick pairing within five minutes. Hosting resumes on app launch until you stop it in Settings. The current iPhone build connects through a paired desktop-hosted private HTTPS bridge; it cannot read another iOS app's private data.

## Run locally

Use Node.js 24 LTS or a supported newer version.

```sh
npm ci
npm run build
npm run desktop
```

For development, run `npm run dev`, then in a second terminal:

```sh
GROKDECK_DEV_URL=http://127.0.0.1:5173 npm run desktop
```

On PowerShell, set `$env:GROKDECK_DEV_URL = 'http://127.0.0.1:5173'` before `npm run desktop`.

## Connect your data

GrokDeck automatically checks the conventional Grok Bot data folder:

- macOS: `~/Library/Application Support/Grok Bot`
- Windows: `%APPDATA%/Grok Bot`

Open Grok Bot and sign in on that computer first. If the folder differs, use **Settings → Choose folder** and select its data folder or `sand-client-persistence` subfolder. Only the selected active account is loaded. You can choose a copied cache folder, but it will remain a snapshot unless you refresh that copy yourself.

The adapter is verified against the macOS Grok Bot 0.75.0 cache. Windows path handling and parser behavior are tested; a Windows Grok Bot cache and Windows runtime still require device verification. No assumption is made that a cache exists on every computer.

## Build installers

```sh
npm run package:mac  # macOS arm64 + x64 ZIP and DMG, on a Mac
npm run package:win  # Windows x64 ZIP and NSIS installer, on Windows
```

GitHub Actions builds both platforms and retains downloadable artifacts. CI produces unsigned previews; Mac releases include locally signed/notarized builds. Windows signing remains to be configured. No release is published automatically.

## Validate

```sh
npm test
npm run build
npx playwright install chromium
npm run test:ui
```

Cache tests cover active-account isolation, unsupported schemas, corrupt files, symlink rejection, transcript normalization, version warnings, and source non-mutation. UI tests cover search, drafts, notes, preferences, an explicit example workspace, a 120-agent fixture, and untrusted transcript HTML.

## Privacy

No analytics or cloud sync. The default cache adapter reads no credentials. The opt-in live helper reads the active Grok Bot session through OS secure storage on the Mac, keeps decrypted credentials in memory, and sends them only to the observed vendor backend/gateway. The phone receives a separate GrokDeck pairing key, never the Grok Bot session. Optional release checks contact Grok Bot’s official update service with the platform, installed version, and a separate ephemeral rollout ID; they send no account credentials or conversation content. Cache mode reads only allowlisted cache slices and optional `desktop-status.json`. Live mode uses a separate authenticated loopback bridge; the optional phone proxy binds one explicit private LAN address over pinned HTTPS. Notes, pins, drafts, and reviewed markers live in GrokDeck's own local preferences. Exported discussions and clipboard contents may contain your private text; export/copy only when you intend to share them. External images and HTML are not loaded from transcript content.

See [architecture and investigation notes](docs/architecture.md) and [remaining work](docs/roadmap.md).

## iOS prototype

A native SwiftUI companion supports cached and experimental live discussion modes. The physical iPhone is development-signed and paired over private Wi-Fi. An authorized isolated test was accepted by the real gateway and returned `GROKDECK_OK`. See [iOS setup, API, and limitations](docs/ios-prototype.md).

## Experimental live bridge

```sh
npm run bridge:live
# In a separate terminal, for the paired phone on your trusted home network:
GROKDECK_LAN_HOST=YOUR_MAC_PRIVATE_IPV4 npm run bridge:lan
```

Stop the default `npm run bridge` first because both use pinned HTTPS port 43875. The Mac helper may request Keychain access. It binds its initial account and team; restart it explicitly after switching either in Grok Bot. Do not put tokens into command arguments, source, chat, or Notion. See [connection evidence and limits](docs/live-connection.md) and [iPhone pairing](docs/ios-prototype.md). The live bridge is a developer command, not an automatically enabled service in the desktop installer.

## App updates

GrokDeck 0.2.2 detects its own GitHub releases as well as Grok Bot releases. Open Settings → GrokDeck updates. Signed Mac builds can download and restart to install; unsigned Windows previews use manual downloads. Private updates use your existing GitHub CLI sign-in or a host-only token. Once the repository is public, public release checks can work without credentials. [Update setup and limits](docs/app-updates.md) · [Grok Bot 0.75.8 review](docs/compatibility-0.75.8.md).

Security upgrade 0.2.3 uses an authenticated local TLS connection and a new pairing credential. See [security upgrade and re-pairing](docs/security-upgrade-0.2.3.md).

## Agent computers on iPhone

Open Computers and choose View computer for a running agent. The viewer opens full screen, supports portrait and landscape, and enables touch control on connection. Use the hand button to turn control off; Keyboard types text and provides Return, Tab, and Escape. Leaving the viewer or backgrounding the app disconnects the session.

If a computer is unavailable, choose Open in Grok Bot. This targets the agent; select its computer in Grok Bot. The selected-agent handoff is verified on iPhone; a direct-to-computer deep link is not. Sleeping computers are not automatically started by GrokDeck.

The helper relays authenticated screen data; upstream computer credentials stay on the desktop. Viewer sessions expire after ten minutes or thirty seconds without activity. Reopen the viewer to reconnect.

## License and contributions

[MIT](LICENSE), copyright Ron Millar 2026. Reuse and contributions are welcome with the license notice retained. See [third-party notices](THIRD_PARTY.md) for the noVNC viewer's MPL 2.0 license. Do not include account tokens, setup codes, private chats, or screenshots of sensitive desktops in issues.
