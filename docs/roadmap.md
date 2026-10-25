# Next milestones

## First build verification

- Produce Mac arm64/x64 installers and Windows x64 installer/ZIP.
- Run packaged Mac app against real Grok Bot cache; verify conversation handoff.
- Run Windows package on Windows; verify real cache path, sleep/reconnect, and handoff.
- Verify MacBook Pro architecture and runtime separately from the Mac mini.

## Complete the integration

- Experimental direct discussion reads and text sends are verified against 0.75.0. Next validate reconnect/expiry and real-device sending under varied network conditions; no public API compatibility is promised.
- Replace foreground transcript polling with a verified event-stream adapter when needed; preserve scrollback and pending-send semantics.
- Keep the connection adapter separate from UI code and document version compatibility.
- Improve attachments, permissions, agent exchanges, and non-text transcript rendering from observed schemas.
- Verify Ghidra setup and investigate native components only when a concrete integration question depends on them.

## Maintainability and distribution

- Test the adapter against new Grok Bot releases advertised by the official feed; availability notifications do not imply verified compatibility.
- Add signed GrokDeck update manifests, rollback, and private distribution.
- Sign Windows builds and sign/notarize Mac builds before wider distribution.
- Add an explicit migration/backup policy for local notes and customization.

## Product exploration

- A chronological cross-agent catch-up view linked to source messages.
- Custom sections and a configurable recent-chat rail.
- Rich, useful status presentation with timestamps and an honest distinction between execution evidence, cached state, and inference.
- Optional preference sync only after choosing a privacy model.

Bot HQ is reference material, not this project's specification or execution owner. No per-step reports are sent to bots.
