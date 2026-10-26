# GrokDeck security review — October 26, 2026

The findings below describe 0.2.2. The implemented fixes and 0.2.3 validation are recorded in [the security upgrade report](security-upgrade-0.2.3.md).

## Result

**Do not treat this release as security-cleared for public distribution.** One
high-priority local trust defect and one response-size enforcement defect were
confirmed. Production hardening is also incomplete. No fixes or replacement
release were applied as part of this review.

Scope: source commit `7708e358e9efdf55a58e845ac46f523d369c7cc2`, the signed
Apple Silicon 0.2.2 Mac artifact, and the shared Swift bridge client. Reviewed
credential/session handling, bridge authorization, TLS pairing, updater trust,
renderer/IPC boundaries, message rendering, dependencies and CI permissions.
The eight principal desktop/bridge security files checked against the packaged
ASAR exactly match the reviewed source. This is a focused source/artifact review,
not an exhaustive penetration test or certification. Windows account integration
and physical iPhone adversarial tests were not performed.

## Findings

### GD-SEC-001 — High priority: loopback listener impersonation discloses the bridge credential

Evidence: `desktop/live.cjs:14`, `desktop/bridge-process.cjs:10`, and
`bridge/lan.mjs:102`.

The desktop sends its persistent bearer credential to HTTP port 43872 before
authenticating the server. Startup adopts an existing listener if it returns the
expected health JSON. The LAN proxy also forwards the same credential to its
loopback upstream without authenticating that upstream.

A malicious local process that binds the port while the genuine helper is absent
can collect the credential. It need not read the protected credential file. After
releasing the port, the stolen credential remains valid when the real helper
starts. It authorizes bridge reads and, when live mode is available, send and
interrupt operations in the owner's Grok Bot account. A different local OS user
can bind an unoccupied unprivileged loopback port; that cross-user scenario was
not exercised on a second OS account. This is a **local-host attack**, not a
demonstrated Internet or Wi-Fi authentication bypass.

Reproduction used the actual desktop client, process manager and bridge with a
dummy credential and ephemeral HTTP servers. A test transport substituted an
ephemeral port so the real running helper was untouched. Observed:

- the fake listener received the dummy credential;
- the manager adopted it without spawning the helper;
- the captured credential was accepted by the real bridge implementation against
  a synthetic cache reader.

No real token was read for this probe; no vendor request or bot message was sent.

Remedy: replace the unauthenticated TCP hop with a user-restricted Unix socket
and Windows named pipe with explicit owner ACLs, or pinned local TLS with the
server identity stored in an owner-only location. Cover both desktop-to-helper
and LAN-proxy-to-helper traffic. A port/PID check alone is race-prone, and simply
adding a proof followed by plaintext bearer transmission does not provide a
fully authenticated channel. Add an impersonation regression test that proves
no credential is transmitted to an untrusted listener. Rotate existing bridge
credentials after deploying the corrected transport if exposure is suspected.

### GD-SEC-002 — Medium priority: iOS response limit is checked after allocation

Evidence: `ios/GrokDeck/Models.swift:236` and `:248`.

`URLSession.data(for:)` buffers the complete response before the 8 MiB check.
The declared limit therefore does not bound network consumption or memory.
A malicious or compromised configured bridge can send a much larger response,
potentially causing memory pressure or app termination. Normal LAN traffic is
protected by pinned TLS, so an arbitrary Wi-Fi peer cannot exploit this without
defeating that trust boundary.

The exact shared Swift client was compiled and run on macOS against a synthetic
HTTP loopback server. It downloaded all 9,437,242 bytes, then rejected the body;
the intended ceiling is 8,388,608 bytes. A memory-exhaustion crash was not attempted
or observed, and this was not a physical iPhone test.

Remedy: use a streaming response reader/delegate, reject an excessive declared
length early, count actual bytes, and cancel the task as soon as the cap is
crossed. Test both Content-Length and chunked responses, including error bodies.

### GD-SEC-003 — Hardening gap: permissive Electron production fuses

The signed 0.2.2 executable was inspected with `@electron/fuses`. RunAsNode,
NODE_OPTIONS and CLI inspector support are enabled. Embedded ASAR integrity
validation and OnlyLoadAppFromAsar are disabled. No exploit was attempted for
these settings; this is defense in depth rather than a separately proven remote
code-execution vulnerability.

Disable unused Node/debug switches and enable ASAR integrity plus ASAR-only
loading before signing. Adapt the current Playwright main-process probes, which
depend on inspector access, rather than retaining production debug access solely
to satisfy tests. Electron documents these controls in its
[fuse guidance](https://www.electronjs.org/docs/latest/tutorial/fuses) and
[security checklist](https://www.electronjs.org/docs/latest/tutorial/security).

## Controls that held up under review

- Renderer sandbox and context isolation enabled; Node integration disabled.
  IPC checks the expected WebContents and main frame. Navigation/new windows are
  denied. Transcript links/images render as inert content; untrusted HTML UI test
  passed. No arbitrary renderer-controlled shell command was found.
- Bridge binds loopback; optional LAN hosting binds one explicit assigned private
  IPv4 address. Requests require a 256-bit bearer token; Host/Origin checks reject
  browser-origin requests. These protect clients authenticating to the server,
  but do not resolve GD-SEC-001's missing server authentication.
- Phone quick pairing uses a five-minute single-use invitation and pinned HTTPS.
  The Swift trust delegate verifies the exact certificate, host and validity and
  rejects redirects. Pairing is stored in device-only Keychain storage.
- Backend credentials stay in the host process; backend/gateway destinations and
  headers are restricted, redirects rejected, and session account/team/version
  checked. Messages have nonce handling and uncertain delivery is not retried
  automatically.
- GrokDeck updates use a fixed repository, host-only GitHub credentials, signed
  Mac installation eligibility, and explicit download/restart. Real signed Mac
  update/relaunch tests were already verified. Windows remains unsigned and
  cannot use the signed-install path.
- On this Mac, the bridge directory is mode 0700 and its token file is 0600.
  No token value was printed. Phone credentials are shared across paired clients;
  per-device revocation remains a design improvement. Forgetting pairing on the
  phone is local deletion, not host-side revocation.

## Validation and limits

- `npm audit`: zero reported known vulnerabilities across the audited dependency
  graph. This does not cover every Electron/OS vulnerability or prove absence of
  unknown issues.
- 91 Node tests and 7 browser UI tests passed.
- Targeted private-key/GitHub-token/AWS-key/live-Stripe/JWT pattern scan of 81
  tracked files: no matches. Targeted packaged desktop/bridge/dist code scan:
  no private-key/GitHub-token/AWS-key matches. These are heuristic checks, not a
  complete historical secret scan.
- Packaged `app-update.yml` contains no token.
- Isolated loopback impersonation and Swift oversized-response probes confirmed
  GD-SEC-001 and GD-SEC-002. Local probe sources are retained under ignored
  `research/evidence/security-2026-10-26/`.
- No live sends, credential rotation, helper replacement, account changes,
  production code edits, publication, or destructive testing occurred.

Remediation order: authenticate the local transport first, enforce streaming
response limits second, then harden production fuses and re-test signed packaging
and updates before broader distribution.
