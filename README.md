# GrokDeck

A standalone desktop workspace for exploring your Grok Bot agents and discussions. Built with Electron, React, and TypeScript for macOS and Windows.

## Version 0.1

- Reads the **real local Grok Bot cache**: agents, sections, unread markers, and cached conversation history.
- Search names, results, and discussion text; reopen conversations through Grok Bot's agent deep link.
- Pin agents, keep private notes, save follow-up drafts, and mark items reviewed locally.
- Export an individual cached discussion as Markdown.
- Customize dark/light/system appearance, accent color, text size, and density.
- Detect the locally running Grok Bot version and warn when it differs from the tested adapter version.
- Explicitly labeled example workspace for exploring the interface without local data.

**Limits:** This first build is a local companion. It does not authenticate to Grok Bot's backend, send messages directly, provide live execution status, or retrieve history absent from Grok Bot's local cache. Follow-ups are copied to the clipboard and opened in Grok Bot for you to paste and send. Changes in GrokDeck never modify Grok Bot's cache. Upstream release-feed monitoring and automatic updates are not implemented.

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

No telemetry, cloud sync, or credential reading. The main process reads only allowlisted cache slices and optional `desktop-status.json`. Notes, pins, drafts, and reviewed markers live in GrokDeck's own local preferences. Exported discussions and clipboard contents may contain your private text; export/copy only when you intend to share them. External images and HTML are not loaded from transcript content.

See [architecture and investigation notes](docs/architecture.md) and [remaining work](docs/roadmap.md).
