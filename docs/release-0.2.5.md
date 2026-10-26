# GrokDeck 0.2.5 preview

GrokDeck connects to the owner's local Grok Bot installation automatically. Windows uses the signed-in Windows installation; Mac uses the signed-in Mac installation. iPhone pairs with a selected desktop helper over trusted local Wi-Fi. A selected copied/custom cache stays read-only and never silently connects to a different live account.

The native iPhone computer viewer uses the authenticated bridge and a locally bundled noVNC renderer. Computer credentials remain on the desktop. Only roster-member agents and validated vendor computer routes can be opened. Expiring sessions have ordered exchanges, replay protection for duplicate sequences, bounded buffers, and account/team checks. Arbitrary proxy URLs are not accepted. The phone renderer has no network access or Grok Bot credentials. Computer input uses the viewer's Control toggle, which defaults on after a successful connection at the owner's request. Closing/backgrounding closes the session; idle sessions expire after 30 seconds and all sessions after ten minutes.

## Verified

- Live remote-desktop handshake and a 1920 × 1200 canvas on the Mac test renderer.
- Physical iPhone: owner confirmed the desktop appears, touch and typing work, and full-screen landscape fits with Control enabled.
- Physical iOS build/install/launch; setup uses the owner's existing pairing.
- 100 Node tests, including viewer route rejection, replay prevention and buffer/lifetime limits.
- Desktop Electron bridge and UI smoke tests, and seven browser UI tests.
- Secret scan of Git history and proposed public files: no findings.
- Production dependency audit: no known vulnerabilities reported at this check.

## Release limits

Windows live account access still requires a real Windows machine check. Windows installers are unsigned and use manual installation. iOS is development-signed; public TestFlight/App Store installation is not yet available. Users can build for their own development team with Xcode. No assurance is made that every Grok Bot computer configuration exposes a compatible remote viewer. Starting sleeping computers remains in Grok Bot.

Open in Grok Bot targets the selected agent, not a verified computer-specific deep link. There is no automatic resend of chat messages or automatic approval of agent actions. GitHub publication does not establish App Store availability or Windows live-runtime verification.
