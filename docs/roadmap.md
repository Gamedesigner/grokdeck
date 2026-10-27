# GrokDeck roadmap

GrokDeck is public and MIT licensed. The product goal is a clearer Grok Bot experience for people managing many agents, with room for contributors to build their own workflows. Visible credit: “GrokDeck by Ron Millar 2026”, linking to https://ronmillar.com.

## Available in the 0.3.0 desktop preview

- Automatic live connection to the signed-in Grok Bot installation on the same computer.
- Grouped Overview with favorites first, drag-and-drop ordering, right-click moves, and group create/rename/delete. Groups and pins synchronize with Grok Bot.
- All agents sorting and group/status filters, search, discussions, emoji, replies, local notes and drafts.
- Desktop computer viewing and control, explicit start/resume, full screen, and Grok Bot fallback.
- Agent name, title, description, and image editing.
- Signed/notarized Apple silicon and Intel Mac downloads, plus an unsigned Windows preview.

The native iPhone 0.2.5 development build pairs with a desktop helper and supports live discussions, full-screen computer viewing, landscape, touch, typing, and selected-agent fallback. It is not yet available through public TestFlight or the App Store.

## Next areas to improve

- Easier iPhone installation and pairing, plus a secure remote-access option for use away from the local network.
- Windows signing and end-to-end real-account checks, separate from CI’s packaging and synthetic secure-storage tests.
- More reliable screen availability and clearer recovery when Grok Bot reports a running computer whose screen endpoint fails.
- Richer conversation content and more agent actions, keeping explicit user intent and account isolation.
- Workflows for larger agent collections: quicker catch-up, better navigation, and useful organization controls.
- Additional Intel Mac and MacBook hardware checks; real-account custom-image upload verification.

These are development directions, not release-date commitments. Ideas, forks, and pull requests are welcome; see [CONTRIBUTING](../CONTRIBUTING.md).

## Maintenance boundaries

Unknown Grok Bot versions stay gated until their interfaces are reviewed. Checks and screenshots must distinguish fixtures, CI, packaged applications, and real devices. A successful build does not prove every vendor account or screen will work.

The maintainer’s local compatibility automation is paused. The manual checker and hosted CI remain available; no always-on monitoring service is promised. No per-step reports are sent to bots.
