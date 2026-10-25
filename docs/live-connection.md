# Experimental live connection evidence

Verified October 25, 2026 against the installed Grok Bot desktop 0.75.0. This is private interoperability research and original adapter code; it is not a supported public API. No proprietary JavaScript, credentials, transcripts, or captured account metadata are committed.

## Evidence and observations

REA 6.4.0 analyzed the installed ASAR as inert JavaScript. Evidence: `ev_1ecf2c17bdaf7310f57ccbcbaf476bd868cc87792dbca08e920ef6e928e73865`. Artifact SHA-256: `1035db7b1f77974c78e6c18a4426a5fe16c639946335f7d57badfd0761971a5e`. The complete local evidence is excluded at `research/evidence/grokbot-connection-rea.json`. Analysis covered 759 parsed JavaScript files with no parse failures. Expanded graph coverage is incomplete due to result limits. Nine unpacked native members contradicted declared archive integrity; REA recorded those observed native bytes as untrusted. They were not executed or used to establish the connection protocol. No Ghidra decompilation was needed for this JavaScript connection path.

Focused ordinary static inspection recovered `sendPrompt`, `promptAcceptanceStatus`, `getAgentTranscriptTail`, `listAgents`, and `interruptAgentRun`; JSON request/reply schemas embedded in the coordinator bundle confirmed their shapes. Backend discovery uses `aiserver.v1.GrokBotService/EnsureSandBox`. The observed gateway exposes JSON POST commands under `/api/`. The vendor app also implements an event stream, but GrokDeck currently polls discussion tails instead.

Actual runtime checks, separate from the static findings:

- The OS secure-storage API decrypted the current saved session locally; the JWT principal matched the active account scope.
- Authenticated discovery returned an HTTPS `cursorvm.com` gateway with its scoped credentials.
- Live roster and transcript reads returned HTTP 200 (48 agents at the time of the initial check).
- With explicit user approval, one dedicated **GrokDeck Connection Test** bot was created and one prompt sent: “Reply with exactly GROKDECK_OK. Do not use tools or take any other action.”
- The bridge returned `accepted: true`; an independent acceptance lookup reported accepted, and a transcript read returned the exact assistant reply `GROKDECK_OK`.
- The user confirmed the agent list appeared on the physical iPhone over the private HTTPS connection. That confirms phone-to-Mac cache access; the live composer was installed afterward and remains a separate user/device UI check.

## Host and client boundaries

`npm run bridge:live` starts a separate rendererless Electron helper so OS secure storage remains available. The helper uses Grok Bot's storage application name for compatibility with its saved key; its executable is Electron and macOS may ask the user for Keychain access. It reads the vendor app's saved active session without modifying it. It does not refresh tokens or perform account sign-in. If the session expires, return to Grok Bot to refresh sign-in. The helper refuses any app version other than 0.75.0 and binds its startup account/team until explicitly restarted.

Discovery credentials go only to the fixed observed vendor backend. Gateway credentials go only to validated HTTPS subdomains of `cursorvm.com`; redirects are rejected. Credentials are not returned to UI clients or exported to files. The independently generated 256-bit GrokDeck pairing key authorizes the narrow bridge API and is stored device-only in the iPhone Keychain after authenticated pairing succeeds.

`npm run bridge:lan` is optional and requires one exact locally assigned RFC1918 address. It terminates TLS with a locally generated leaf certificate. The phone checks the exact SHA-256 leaf fingerprint plus hostname/SAN, signature, and dates. No system CA or certificate-validation exception is installed. Keep this listener on your trusted private network; no public tunnel or router port mapping is configured. Stop the command to stop serving it.

## API and delivery

All routes require the GrokDeck bearer pairing key. Browser Origin and unexpected Host headers are rejected. Cache-only mode remains read-only. Live mode provides:

- `GET /v1/health`: `apiVersion:1`, `live:true`, `readOnly:false`.
- `GET /v1/agents`: current roster without transcripts or credentials.
- `GET /v1/agents/{id}/messages`: latest 100 entries, normalized for UI, source `live-gateway`.
- `POST /v1/agents/{id}/send`: `{prompt,clientNonce,replyToId?}` with a fresh UUID per new user message; returns accepted/rejected/unknown.
- `GET /v1/agents/{id}/sends/{nonce}`: independent acceptance lookup.
- `POST /v1/agents/{id}/interrupt`: empty JSON object, explicit user action.

There is no automatic send retry. Concurrent duplicate requests with the same nonce/content coalesce in the bridge process. Uncertain delivery remains unknown and locks the current composer until checked; it is never mislabeled failed. Nonces are not a complete durable outbox across process/device restarts, so inspect the conversation before manually composing an uncertain message again. The gateway's deduplication/acceptance behavior is version-specific. Approvals and attachments remain in Grok Bot.

Opening a discussion initially shows its latest point. Background refresh does not drag the reader away from older messages; Jump to latest is explicit. Device, MacBook Pro, Windows real-account integration, token expiry, and event-stream reconnect behavior require further verification. A passing fixture/CI build does not establish those device results.

## Replies, avatars, and computer status

Reply targets must exist in the selected agent's current transcript tail. The host derives the quote from that actual entry, so clients cannot supply a forged quotation. The send nonce binds prompt and reply context together. Unicode text, including multi-code-point emoji, remains text end to end; quick emoji buttons only insert into the composer. The top search icon reveals a search field, and typing/quick replies stay at the bottom of the chat.

Authenticated avatar reads reuse current-roster data or the exact referenced local raster image, with a read-only vendor avatar lookup as fallback. Only bounded PNG/JPEG/WebP data is returned; external image URLs and SVG are rejected. Images are cached in app memory. Bots without provided raster pictures retain initials; vendor procedural robot artwork is not reproduced.

`GET /v1/computers` performs a bounded, manually refreshed read of per-bot computer status, at most three requests at a time with an eight-second work budget. Explicit absent, hibernated, and running states are retained; null, failed, timed-out, or unexamined entries are unknown. This is a per-bot list, not a deduplicated inventory of physical hosts. VNC URLs and credentials are omitted. A live check returned HTTP 200 with complete results: two running and 48 absent, in roughly one second. Counts describe that check and can change. No start/ensure, update, or VNC-viewer command was called. Viewing and starting a computer are not implemented in this build.
