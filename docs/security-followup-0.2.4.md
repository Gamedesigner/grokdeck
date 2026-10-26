# Electron TLS compatibility correction — 0.2.4

The 0.2.3 helper could serve standalone Node clients, but Electron rejected its self-signed, non-CA local certificate. The desktop connection check therefore timed out and stopped the helper. The packaged smoke test covered the UI and fuses, but did not exercise the bridge inside Electron; Node-only TLS tests missed this difference.

The local identity now uses a self-signed trust anchor with CA constraints and a zero-length subordinate path. It is trusted only by the explicitly configured local HTTPS request. The client still verifies the exact peer fingerprint, loopback IP, certificate dates and TLS signature. Nothing is installed in the system trust store, and certificates signed by that key are not accepted as substitute peers. LAN certificates and the v2 phone token are unchanged.

New installations use `local-tls-v3.json`. The Mac's existing v2 identity was backed up and atomically replaced with the compatible identity to restore the installed 0.2.3 app while the new build is prepared. No private key or token value was logged. Independently running old helpers must still be stopped during upgrade.

`scripts/electron-bridge-smoke.cjs` exercises the actual desktop TLS client inside Electron: a valid pinned connection succeeds, while an impostor never receives an HTTP request or credential. It runs with the desktop suite on Mac and Windows CI. The Node impersonation and native Swift download-limit checks remain in place.
