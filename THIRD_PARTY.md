# Third-party software

GrokDeck's own source is MIT licensed. Dependencies retain their own licenses.

The iOS computer viewer bundles noVNC 1.6.0, copyright the noVNC authors, under the Mozilla Public License 2.0. Its license is included with the viewer in `ios/GrokDeck/Viewer/noVNC-LICENSE.txt`. noVNC includes components with additional notices preserved in its source and bundle.

Complete upstream source is available in the pinned `@novnc/novnc@1.6.0` npm package at https://registry.npmjs.org/@novnc/novnc/-/novnc-1.6.0.tgz and https://github.com/novnc/noVNC/tree/v1.6.0. Run `npm ci` to obtain that exact source. `scripts/viewer-vite.config.mjs` contains the sole build-time change: disable WebCodecs H.264 detection so the CommonJS distribution can be bundled without top-level await. Other noVNC source is unchanged. `scripts/viewer/client.js` is GrokDeck's MIT-licensed integration; run `npm run build:viewer` to reproduce the bundled viewer. The MPL-covered source and modification remain available under MPL 2.0.

No Grok Bot application code, credentials, transcripts, or proprietary resources are bundled. GrokDeck is independent and is not endorsed by Grok Bot, xAI, or Cursor.
