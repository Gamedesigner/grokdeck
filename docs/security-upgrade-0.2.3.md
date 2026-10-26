# Security upgrade 0.2.3

This upgrade addresses the three findings in the [October 26 review](security-review-2026-10-26.md). The original report describes 0.2.2 and remains historical evidence.

## Connection changes

The desktop and phone proxy authenticate the local helper with TLS before transmitting a bearer credential. The helper binds only `https://127.0.0.1:43875`. The leaf certificate must match the stored identity, IP address and validity period. There is no plaintext fallback. The optional LAN endpoint still uses its separate pinned certificate and one-use enrollment invitation.

A new `~/.grokdeck-bridge/pairing-token-v2` is generated; the previous token does not authorize the upgraded helper. The local certificate and private key are stored together in `local-tls-v2.json`. The directory is restricted to its owner (0700 on POSIX; protected current-user DACL on Windows), and files use 0600 on POSIX. Identity reads reject symlinks and, on POSIX, foreign owners. These controls do not defend against malicious code already running as the same OS user.

## Upgrade and pair again

1. Quit the old GrokDeck desktop app. Stop any separately launched old `bridge:live`, `bridge` and `bridge:lan` processes through their owning terminal. Independently running legacy helpers are not terminated automatically.
2. Install/open the upgraded desktop and connect live. Allow the normal Grok Bot Keychain prompt if macOS presents it.
3. Upgrade the iPhone app, enable Phone Access on the desktop, and use a newly generated Phone Setup. Existing phone credentials belong to the previous bridge and must be replaced.
4. Verify that the agent list and an existing discussion load. No test message is required for pairing.

The old credential file is not deleted automatically because independently running older processes may still use it. Keeping an old helper running preserves its old vulnerability. Do not use an old helper as a fallback. Local TLS identities expire after one year and fail closed; stop the helper, remove its local identity file, and restart to renew it. LAN certificates retain their separate 30-day lifetime and require phone re-pairing after renewal.

## iOS and production hardening

The Swift client reads responses incrementally, checks declared length before reading, caps accumulated bytes at 8 MiB, and cancels on overflow/error. Both session and task authentication delegate paths verify the pin. Redirects are rejected. Plain HTTP endpoints are no longer accepted, including simulator loopback.

Production Electron fuses disable RunAsNode, NODE_OPTIONS and main-process inspector arguments. ASAR integrity and ASAR-only loading are enabled before signing. Mac preview packages require at least ad-hoc signing after fuse changes; distributable Mac releases use Developer ID signing and notarization.

The development desktop suite retains main-process mocks. `scripts/packaged-security-smoke.mjs` verifies the actual packaged fuses and tests the renderer through an explicitly requested temporary loopback CDP endpoint; it does not enable the main-process inspector. Ordinary app launches do not request a debugging endpoint.

## Verification commands

- `npm test`, `npm run build`, `npm run test:ui`, `npm run test:desktop`
- `node scripts/test-ios-response-limit.mjs` (macOS Swift toolchain; isolated TLS fixtures, no real credentials)
- `GROKDECK_EXECUTABLE=/absolute/path/to/executable node scripts/packaged-security-smoke.mjs`
- Xcode GrokDeck unit and UI tests on the dedicated simulator

Release validation still needs matching-source Mac/Windows artifacts and the real signed updater path. A source fix or simulator pass is not proof of physical-device pairing or Windows account integration. Maintenance remains paused during validation.

### Local validation recorded October 26

- 97 Node tests, 7 browser UI tests, and the development Electron integration smoke pass.
- iOS simulator: 13 unit tests and 9 UI tests pass. The exact shared Swift client also passes separate native macOS TLS fixtures: valid reply, wrong pin, redirect, oversized declared body, oversized chunked body, and oversized 401 body. The 32 MiB fixtures are cancelled early; the chunked fixture sends about 8 MiB plus network buffering, while application accumulation is capped at 8 MiB.
- A signed Intel Mac candidate launched under Rosetta with all five intended fuse settings, renderer isolation and persisted preferences verified. This candidate preceded the final startup/file-read fixes; matching final artifacts still require rebuilding and verification.
- No physical-phone installation, live bot message, or Windows-machine integration test was performed during these checks. Existing running installations have not yet received these fixes.
