# Grok Bot 0.77.0 compatibility review

Reviewed October 26, 2026. GrokDeck's source adapter supports exactly 0.75.0,
0.75.8, and 0.77.0; unknown later versions remain blocked for live access.
The 0.77.0 changes ship starting with GrokDeck 0.3.0-rc.5.

## Official artifacts and static review

The official update feed offered 0.77.0 for Windows x64, Mac arm64 and Mac x64.
Downloaded packages were extracted as data; their proprietary JavaScript was
parsed, not executed. Extracted source and detailed comparison evidence remain
in ignored local research directories and are not distributed with GrokDeck.

| Platform | Download SHA-256 | ASAR SHA-256 |
| --- | --- | --- |
| Windows x64 | `49127551d25c17c24cbbfb936df6c537e4b35311be7ecfe7a250c3da9cd2b20b` | `b3a9d130f0092371843ef95648461c2af6b2657bc242a2da51674d974fae7732` |
| Mac arm64 | `cb2fae7d232cc8b3eb3f60d96c3150ade2c9e8ac3e89cc328a9badf4d2921e7a` | `adb7b74305dc63633a596df7c477210a2a4a88d49871ac91ab7d2f55c2fe973a` |
| Mac x64 | `1c396ddc96cabd2ee70b374c3da9974dc03739770233dfe1f59fc4f20965f018` | `778d954511a7e29b2b541a7fc7ef61796cdf9d83c3c94b23209ef97715c41aca` |

REA 6.4.0 analyzed the Windows ASAR. Evidence ID:
`ev_84a2a7706fcda7f117ad6ffabd616e3675b6220552af357093a34749be1b8de5`.
It inventoried 711 relevant files and parsed 684 JavaScript files with zero parse
failures. Its graph has incomplete coverage and reports ten native artifact
integrity contradictions. Those native members were not executed or used as
protocol evidence. This is not a whole-app security audit.

Focused AST comparisons against 0.75.8 found:

- The 12 gateway request declarations remain compatible. New fields on transcript
  reads, sends and acceptance lookup are optional.
- Session containers, account isolation, safeStorage wrappers, client/team headers,
  desktop-status writer and EnsureSandBox descriptors match after identifier
  normalization or exact descriptor comparison.
- Avatar/profile/computer request shapes and primary/fork viewer routing match.
- Group synchronization changed materially and requires the adapter changes below.

## Group synchronization

0.77.0 treats user runtime settings as authoritative for sidebar groups. It falls
back to legacy host settings only when the cloud field is absent. An explicitly
empty cloud group list must remain empty.

GrokDeck now follows that behavior for 0.77.0. Saves write runtime settings only,
include the actual previous `sidebarSectionsBase` when available, and require
explicit server confirmation plus readback. Account, team and version remain
bound to the read snapshot. A Connect Aborted conflict stops the save without
retrying. The 0.75 adapters retain their prior two-store behavior.

Fixture tests cover stale edits, explicit-empty groups, migration fallback,
conflicts, uncertain/missing confirmation, invalid fields and snapshot identity.
No live group edit was performed for this review.

## Live Mac checks and limits

After the owner updated Grok Bot, both the installed bundle and running status
reported 0.77.0. The corrected source adapter passed read-only checks using the
existing locally protected session:

- Session decryption and gateway discovery.
- Live roster and an existing test conversation's transcript.
- Avatar lookup and server-authoritative groups/pins.
- Computer status and a running computer's RFB/WebSocket handshake.
- Local cache parsing with no schema warnings.

Only counts and status were recorded. No prompt, agent/profile edit, group change,
computer start, mouse action or keyboard input was sent. A screen handshake does
not establish full interactive control. Windows real-account decryption and
runtime behavior, and 0.77.0 live writes, remain separate device checks.

## Refresh recovery

The toolbar previously fetched a snapshot without ensuring its helper was running.
Manual refresh now uses the connection/recovery path, preserves loaded content on
failure, and shows connection guidance. Recovery can replace an unhealthy helper
owned by GrokDeck after it exits; it does not terminate an independent helper and
will not discard a known unresolved desktop send. Native inspection found the old
installed helper unavailable after the Grok Bot upgrade, consistent with the old
version gate. The exact Windows error has not been independently observed.
