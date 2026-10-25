# GrokDeck

A standalone desktop workspace for exploring your Grok Bot agents and discussions. Built with Electron, React, and TypeScript for macOS and Windows.

## Version 0.1

- Reads the **real local Grok Bot cache**: agents, sections, unread markers, and cached conversation history.
- Search names, results, and discussion text; reopen conversations through Grok Bot's agent deep link.
- Pin agents, keep private notes, save follow-up drafts, and mark items reviewed locally.
- Export an individual cached discussion as Markdown.
- Customize dark/light/system appearance, accent color, text size, and density.
- Detect the locally running Grok Bot version and warn when it differs from the tested adapter version.
- Check the official stable release feed on launch and every six hours, with a manual check and an option to disable background checks.
- Explicitly labeled example workspace for exploring the interface without local data.

**Modes:** The default desktop view reads the local cache. An opt-in experimental live bridge now supports current discussions, sending text and replies with emoji, checking delivery, requesting a run interruption, provided bot pictures, and a read-only per-bot computer status list. On the desktop choose **Connect live** after starting `npm run bridge:live`. Replies refresh every two seconds while the discussion is visible. This is version-specific integration verified against Grok Bot 0.75.0, not a documented public API. Approvals, attachments, and richer actions still use Grok Bot. GrokDeck never modifies its cache or installs Grok Bot updates.

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

GitHub Actions builds both platforms and retains private downloadable artifacts. These early private builds are unsigned. Public distribution needs signing on Windows and signing/notarization on macOS. No release is published automatically.

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

A native SwiftUI companion supports cached and experimental live discussion modes. The physical iPhone is development-signed and paired over private Wi-Fi. An authorized isolated test was accepted by the real gateway and returned `GROKDECK_OK`. See [iOS setup, API, and limitations](docs/ios-prototype.md). The [private Notion project page](https://app.notion.com/p/404d9d2a6a048108b540e65f5c033920) tracks verified work and remaining device checks.

## Experimental live bridge

```sh
npm run bridge:live
# In a separate terminal, for the paired phone on your trusted home network:
GROKDECK_LAN_HOST=YOUR_MAC_PRIVATE_IPV4 npm run bridge:lan
```

Stop the default `npm run bridge` first because both use port 43872. The Mac helper may request Keychain access. It binds its initial account and team; restart it explicitly after switching either in Grok Bot. Do not put tokens into command arguments, source, chat, or Notion. See [connection evidence and limits](docs/live-connection.md) and [iPhone pairing](docs/ios-prototype.md). The live bridge is a developer command, not an automatically enabled service in the desktop installer.
