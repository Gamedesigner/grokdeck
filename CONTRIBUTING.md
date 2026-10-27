# Contributing to GrokDeck

GrokDeck aims to make Grok Bot easier to use as your agent workspace grows. Bring a concrete workflow, a UI improvement, a compatibility fix, or your own fork. MIT licensing allows reuse with the license notice retained.

## Share an idea or bug

Use [GitHub issues](https://github.com/Gamedesigner/grokdeck/issues) for ordinary bugs and feature requests. Include your OS, GrokDeck version, Grok Bot version, steps to reproduce, and what you expected. Settings → Version & compatibility shows the desktop versions.

Use fictional examples or carefully redacted screenshots. Do not post pairing invitations, session tokens, private conversations, account exports, or raw debug dumps. Security concerns belong in a [private report](https://github.com/Gamedesigner/grokdeck/security/advisories/new), not a public issue.

## Make a change

1. Fork the repository and create a branch for one focused change.
2. Follow the README’s source setup. You can explore the built-in example workspace without an account. Browser tests use synthetic fixtures; live testing uses your own account.
3. Keep the UI and vendor adapter separate. Do not weaken version gating, account scoping, TLS pinning, input bounds, or the helper’s credential boundary to make a request work.
4. Run checks appropriate to your change. For code changes, start with `npm test`, `npm run build`, and `npm run test:ui`; native or packaged changes also need their relevant desktop/iOS checks.
5. Open a pull request explaining the user-visible change, how you verified it, and any remaining limitations. Distinguish fixtures and CI from real account/device tests.

If you need to test a write, use a disposable agent or group and describe what you changed. Never add proprietary app bundles, captured sessions, or real conversations to fixtures. Keep generated screenshots fictional and label them as examples.

## Documentation and images

Use relative links for repository files and versioned release links for preview downloads. Keep setup instructions accurate for both Mac and Windows, and state when Xcode or a desktop helper is required.

README screenshots come from the actual renderer via `scripts/capture-readme.mjs`, with synthetic data and no account connection. Run `npm run build` first, then `node scripts/capture-readme.mjs`. Inspect the output before committing it.
