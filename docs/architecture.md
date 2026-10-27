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

The packaged main-core bundle declares agent activation through `grokbot://app/v1/agent?id=<id>`. GrokDeck constrains links to this observed route, verifies that IDs belong to its current roster, and leaves approvals and richer actions in the official app. Sending is supported separately through the opt-in experimental gateway adapter. Runtime handoff must be checked on each platform.

## Preferences and refresh

GrokDeck uses its own app ID and user-data directory. Preferences contain appearance, recent selections, notes, reviewed timestamps, drafts, legacy cached pins, and an optional data-folder selection. In the 0.3.0 preview, live group and pin edits synchronize through the vendor settings adapter. Writes are serialized in the renderer and saved through temporary-file rename in the main process. No preference writes touch Grok Bot.

The cache refreshes every 15 seconds. Cached unread/request state is explicitly labeled and never called live activity. A different locally reported Grok Bot version produces a compatibility warning. The official stable update endpoint is queried on launch and every six hours while enabled, or manually from Settings. Each request uses a separate ephemeral rollout ID, never Grok Bot’s identity or credentials. Errors remain unavailable rather than being reported as up to date. No update download or installation occurs.

The shipped main-core bundle defines the update base URL `https://api2.cursor.sh/updates`, with platform/track/version/rollout-ID segments. Live requests on October 25, 2026 returned stable version 0.75.8 for darwin-arm64 and win32-x64-user. That establishes availability from the feed, not adapter compatibility with 0.75.8.

## Distribution

Electron Builder packages renderer output and the desktop bridge/adapter only. GitHub Actions tests first, then builds separate macOS and Windows artifacts. CI installation bundles are previews; public Mac installers are signed and notarized separately. Windows signing remains pending. Connect live starts a bundled rendererless helper on authenticated loopback when no existing live bridge is available. Quitting the desktop app stops only the helper it started; it never stops an independently running bridge. Separately launched developer bridge commands provide authenticated loopback access and optional pinned HTTPS on one explicit RFC1918 address. No cloud relay or public listener is created.

## Experimental live connection

See [the connection ledger](live-connection.md). The standalone Electron helper reads the active saved sign-in through `safeStorage` without executing vendor JavaScript. Session contents stay in the host process. Discovery uses JSON Connect RPC at the observed vendor backend, then a credential-restricted HTTPS gateway. The bridge exposes a narrow prompt/receipt/transcript/interruption API, rather than arbitrary vendor commands. Membership and mutations are bound to one account/team, and the helper refuses an account/team change until restarted. UI clients must opt into live mode. They distinguish uncertain delivery, retain the message nonce, and never automatically resend. Discussion updates currently use foreground polling rather than a persistent event stream.
