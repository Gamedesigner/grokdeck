# Electron TLS compatibility correction — 0.2.4

The 0.2.3 helper could serve standalone Node clients, but Electron rejected its self-signed, non-CA local certificate. The desktop connection check therefore timed out and stopped the helper. The packaged smoke test covered the UI and fuses, but did not exercise the bridge inside Electron; Node-only TLS tests missed this difference.

The local identity now uses a self-signed trust anchor with CA constraints and a zero-length subordinate path. It is trusted only by the explicitly configured local HTTPS request. The client still verifies the exact peer fingerprint, loopback IP, certificate dates and TLS signature. Nothing is installed in the system trust store, and certificates signed by that key are not accepted as substitute peers. LAN certificates and the v2 phone token are unchanged.

New installations use `local-tls-v3.json`. The Mac's existing v2 identity was backed up and atomically replaced with the compatible identity to restore the installed 0.2.3 app while the new build is prepared. No private key or token value was logged. Independently running old helpers must still be stopped during upgrade.

`scripts/electron-bridge-smoke.cjs` exercises the actual desktop TLS client inside Electron: a valid pinned connection succeeds, while an impostor never receives an HTTP request or credential. It runs with the desktop suite on Mac and Windows CI. The Node impersonation and native Swift download-limit checks remain in place.

## Validation and remaining gates

Local validation passed: 97 Node tests, the Electron bridge regression and desktop smoke suites, production build, six native Swift TLS/response-limit fixtures, and the physical iOS build. Both signed and notarized Mac architectures connected through the packaged main-process client and read 52 agents; Intel was exercised under Rosetta. The installed Mac app is now 0.2.4, and its UI confirms a live gateway connection. The phone host listens on the selected private LAN interface; the helper listens on loopback only.

iOS 0.2.4 build 4 installed on the physical iPhone, but launch was denied because the phone was locked. Successful pairing after the security update remains unverified pending owner unlock.

Hosted desktop and iOS jobs did not start because GitHub reported failed account payments or a spending-limit restriction. No billing settings were changed. Windows 0.2.4 validation and a published 0.2.4 release remain outstanding; local Mac evidence does not establish either. The repository remains private and compatibility maintenance remains paused.
