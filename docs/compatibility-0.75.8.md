# Grok Bot 0.75.8 compatibility review

Grok Bot **0.75.8 on Windows x64** has been statically reviewed against the **0.75.0 macOS** package used for GrokDeck's successful live test. The focused request definitions below match. This supports an explicitly experimental 0.75.8 adapter entry; it does **not** establish a successful Windows sign-in, decryption, connection, send, or reply.

The Mac mini's installed app metadata and running `desktop-status.json` both still reported **0.75.0** during this investigation. The user reported **0.75.8** on Windows. These are separate installations.

## Artifacts and method

- The official Windows update service offered 0.75.8 at `https://downloads.cursor.com/grokbot/stable/win32-x64/0.75.8/Grok_Bot_0.75.8_Setup.exe`.
- Downloaded installer SHA-256: `fc88116d04d91533c88b1524535c131156356a312283bf85e6cb832ecf0029e6`.
- Extracted Windows ASAR SHA-256: `f654ed04c69a81422117f7b67e101931e06a83292b1a631a694fa5eda24606a9`; its `package.json` declares version 0.75.8.
- Baseline macOS 0.75.0 ASAR SHA-256: `1035db7b1f77974c78e6c18a4426a5fe16c639946335f7d57badfd0761971a5e`.
- The installer and its embedded archive were extracted using the existing electron-builder 7zip tool. No vendor executable, JavaScript bootstrap, installer, native add-on, or new app version was executed. No account credentials were read and no messages were sent.

REA 6.4.0 inspected the installer and analyzed the Windows ASAR as inert JavaScript. Complete local evidence remains under ignored `research/evidence/`; proprietary extracted files remain under ignored `research/artifacts/`.

| Evidence | ID |
| --- | --- |
| Windows installer inventory | `ev_46753244899a47efaa6b57426364bde8b7d2aeb840967171bd6c899f8dd00f87` |
| Windows 0.75.8 application | `ev_91bb5e7b8547d44a05e1191b67d02ccb8b7a0070954da0444bd0e81f88061a25` |
| Baseline macOS 0.75.0 application | `ev_1ecf2c17bdaf7310f57ccbcbaf476bd868cc87792dbca08e920ef6e928e73865` |
| REA cross-version graph comparison | `ev_41685206b3e1da3fd43ad7501633bdcfd59ad8de25af345f657c5a41c7267aa5` |

The Windows analysis parsed 764 JavaScript files with zero parse failures. Graph coverage remains incomplete. Eight unpacked native members contradicted archive integrity metadata and were recorded as untrusted; none supplied the request-shape conclusions below. Static findings do not establish runtime reachability or enforcement.

The REA graph comparison reported 1,002 changed and 4,203 unknown observations, with no added/removed conclusion because at least one graph has incomplete coverage. Its reported artifact-identity limitation and these unknowns prevent a whole-app compatibility claim. The bounded request-definition inspection below answers the narrower bridge question.

## Focused findings

These are observations from bounded source/AST inspection of the extracted main bundles, supplementing the REA inventory. Minified variable names are not treated as stable identities.

| Surface | Observed comparison |
| --- | --- |
| Gateway discovery | The serialized `EnsureSandBoxRequest` and `EnsureSandBoxResponse` protobuf field descriptors are byte-identical, including wake, gateway URL/token, network token, and port-token fields. |
| Agent roster | `listAgents` retains its no-arguments declaration. |
| Transcript tail | Same request expression after identifier normalization: ID, optional before-sequence, required limit, optional session ID and unread boundary. |
| Send/reply | The complete `sendPrompt` property object has the same normalized expression, including prompt, agent ID, nonce, reply ID/quote, source, initiator and first-sent time. |
| Acceptance lookup | Same normalized request expression, including required account slot and nonce, optional agent/session IDs and first-sent time. |
| Interrupt | Same ID plus optional session-ID declaration. |
| Avatar/computer status | Same normalized request expressions for `getAgentAvatar` and `getForeverBoxStatus`. No start/computer-control operation was called. |
| Session containers | The `sand-secrets.json`, version-1 account container and active-account names are unchanged. A 210,053-character region beginning at the secrets filename declaration in `main-core.cjs` is byte-identical across these two bundles. This does not prove Windows OS decryption works in our helper. |
| Desktop status | Same version-1 marker fields: PID, appVersion, start time and signed-in state. |

The local comparison script parses JavaScript using TypeScript's parser and normalizes identifier tokens while preserving property names and literals. The five request-expression comparisons matched. This is syntactic evidence, not a claim that arbitrary referenced functions or whole application behavior are equivalent. The full application bundles differ, and this comparison also spans operating systems.

## Integration and remaining verification

Keep an exact tested/reviewed version list instead of accepting arbitrary future versions. Use the actual detected Grok Bot version in connection metadata and the backend client-version header, rather than continuing to report 0.75.0 for 0.75.8. Label 0.75.8 as protocol-reviewed with live behavior still unverified.

Preserve account/team isolation, host-only credentials, schema checks, bounded responses, current roster membership checks, no automatic resend, and read-only computer status. A 0.75.8 helper must still establish its own valid session and pass its initial real roster read before listening.

Windows needs a real-machine test of the saved-session format and OS decryption, roster/transcript reads, and an explicitly authorized isolated send/acceptance/reply test. Computer viewing/start remains outside this change. The macOS 0.75.8 artifact and runtime were not inspected here. The installed macOS 0.75.0 live test remains the only established real-account baseline.

## Subsequent Mac runtime check

After the owner updated the Mac mini, both its installed bundle and desktop-status reported 0.75.8. The revised helper restarted successfully using the existing OS-secured session. Authenticated health, roster (53 agents at observation), and the existing connection-test transcript (2 messages) succeeded. No new message was sent. Windows real-account runtime and 0.75.8 send/acceptance remain unverified. The private phone proxy was retained.
