# GrokDeck updates

GrokDeck 0.2.0 checks its private GitHub releases separately from Grok Bot's official release feed. Both checks run at launch and every six hours when the release-check preference is enabled. Settings exposes separate manual checks. A newer GrokDeck release appears as an update banner.

The updater uses a host-only `GROKDECK_GITHUB_TOKEN`, or an existing `gh auth login` session for github.com. It never bundles a token or sends it to the renderer or phone. No token is written to GrokDeck preferences. Requests are restricted to Gamedesigner/grokdeck; renderer code cannot supply a feed or executable URL. Inaccessible private releases, missing metadata and network failures are unavailable, not up to date. Drafts and prereleases do not establish a current stable release.

Signed installed desktop builds can download through electron-updater and explicitly restart to install. Downloads are not automatic, installation on quit is disabled, and a restart is blocked while message delivery is unresolved. The renderer flushes pending preference saves before requesting a restart. Existing drafts remain in local preferences. Downgrades and web installers are disabled. Windows requires a configured publisher plus a valid matching signature on the running executable; macOS requires a non-ad-hoc TeamIdentifier signature. Download verification remains with electron-updater and the OS.

## Current distribution limitation

The current previews are unsigned and the private repository has no published stable updater release. These builds show manual downloads instead of offering installation. CI now retains `latest*.yml` alongside installers, ZIPs and blockmaps. Signing/notarization and publishing a stable release with its matching metadata are still required before end-to-end automatic installation can be verified. Never ship a GitHub token in app-update.yml or source. A Windows signed build must include its signing publisher in the generated updater configuration. No release is published automatically by CI.

This updates GrokDeck, not Grok Bot. Newly detected Grok Bot versions are never automatically added to the live-protocol allowlist: an app update must carry an explicitly reviewed adapter. Versions 0.75.0 and 0.75.8 are currently allowed; all other versions fail closed for live requests. Version changes invalidate gateway discovery cache. The bridge reports the detected source version rather than a fixed label.

The iPhone app is not replaced by the desktop updater. Its Mac-hosted bridge receives protocol fixes when the helper is restarted; native iOS app updates still require a device build or a future TestFlight distribution.
