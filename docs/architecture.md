# Architecture and investigation notes

## Boundary

The React renderer receives normalized data through a narrow Electron preload bridge. It has no Node access and runs with context isolation and sandboxing. IPC handlers accept calls from the app's main frame only. File selection and export dialogs stay in the main process. External content cannot open windows or navigate the app.

The read-only adapter selects the active account from `client-meta.account-slot`, then reads only that account's roster, sections, UI pins, and transcript replicas. Base32 filenames encode slice keys. It reads no cookies, authentication stores, daemon credentials, or backend tokens. Files with unknown schema versions, oversized blobs, or symlinks are rejected. A failed read produces an empty/error state rather than inventing activity.

## Observed artifact

Inspected `/Applications/Grok Bot.app`, version 0.75.0, an Electron app. The ASAR contains main-process bundles, preloads, React renderer bundles, and native add-ons. Proprietary extracted code and analysis output are excluded from Git and app packages.

REA 6.4.0 analyzed the six extracted preload bundles. Evidence ID: `ev_ee844c985772a0aee880219aea6bd41a17e8335d99cc865ec380054d174b4b0f`. The full local evidence is in ignored `research/evidence/preload-rea.json`. This is static analysis, not proof of runtime behavior. No native Ghidra disassembly has been performed in this build.

Format-aware inspection of real persistence files established these current shapes:

- `roster.last-roster`, schema 4: `value.rows`, agent IDs, display metadata, last entry, unread flags, timestamps, and optional awaiting-response information.
- `sidebar.last-sections`, schema 1: `value.sections` with names and agent IDs.
- `ui-agent-refs`, schema 1: `value.pinnedAgentIds`.
- `transcript.replicas.<agent-id>`, schema 1: `value.entries` and `persistedAt`.

`message` entries have explicit roles. `send-message` entries hold messages sent by the agent; text is in `message.content`. Other entry kinds are retained as placeholders where the companion cannot render them. History may contain only a recent subset and cannot establish completeness or current agent execution state.

The packaged main-core bundle declares agent activation through `grokbot://app/v1/agent?id=<id>`. GrokDeck constrains links to this observed route, verifies that IDs belong to its current roster, and leaves sending/approval execution to the official app. Runtime handoff must be checked on each platform.

## Preferences and refresh

GrokDeck uses its own app ID and user-data directory. Preferences contain appearance, local pins, recent selections, notes, reviewed timestamps, drafts, and an optional data-folder selection. Writes are serialized in the renderer and saved through temporary-file rename in the main process. No preference writes touch Grok Bot.

The cache refreshes every 15 seconds. Cached unread/request state is explicitly labeled and never called live activity. A different locally reported Grok Bot version produces a compatibility warning. No network release check or update installation occurs.

## Distribution

Electron Builder packages renderer output and the desktop bridge/adapter only. GitHub Actions tests first, then builds separate macOS and Windows artifacts. Installation bundles are initially unsigned; signing and notarization are separate release gates. The app has no remote control server, listening network API, or cloud relay.
