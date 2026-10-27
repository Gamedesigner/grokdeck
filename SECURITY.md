# Security and private data

## Report a vulnerability privately

Use [GitHub private vulnerability reporting](https://github.com/Gamedesigner/grokdeck/security/advisories/new). Include the affected version, a minimal reproduction using fictional data, and the impact you observed. Do not include working account credentials or private conversation exports.

Ordinary UI bugs and feature ideas can use public issues. If a real credential has been exposed, revoke or rotate it at its provider; deleting a file or commit does not revoke the credential or remove existing copies.

## What belongs outside the repository

- Grok Bot sessions, authentication tokens, cookies, and account caches.
- GrokDeck pairing credentials and one-time phone setup invitations.
- TLS private keys, signing certificates with private keys, provisioning profiles, and environment secrets.
- Real conversations, local notes and drafts, screenshots of private desktops, and raw research captures.

Keep these in OS-protected storage or ignored local directories. Release bundles should contain application code and dependencies only. Use synthetic fixtures and fictional screenshot data. Never embed a maintainer’s account or pairing information into an app build.

## Current support boundary

This is preview software using version-specific Grok Bot interfaces. Report issues against the latest preview and include both app versions. An older historical release is not a recommendation to keep using it after a security fix. See the [security upgrade](docs/security-upgrade-0.2.3.md) and [TLS follow-up](docs/security-followup-0.2.4.md).

Secret scans are one check, not a guarantee that code or a release has no vulnerabilities. The helper’s account isolation, TLS transport, bounded responses, update checks, and viewer/session boundaries also require ongoing testing.
