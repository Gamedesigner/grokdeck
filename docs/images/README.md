# README screenshots

These PNGs capture the real GrokDeck desktop renderer using fictional agents and messages injected by `scripts/capture-readme.mjs`. They are interface examples, not screenshots of a connected account or evidence of live service availability. No user photos, agent identities, conversations, credentials, or pairing data are included.

After installing dependencies and Playwright Chromium:

```sh
npm run build
node scripts/capture-readme.mjs
```

The script uses a dedicated local preview on port 5178, blocks requests to other origins, and closes its browser and server afterward. It does not start Electron or read a Grok Bot cache. The “live” state is a fixture so that the normal live controls can be shown. Review the rendered images before publishing.
