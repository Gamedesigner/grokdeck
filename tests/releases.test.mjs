import test from "node:test";
import assert from "node:assert/strict";
import { checkRelease, compareVersions } from "../desktop/releases.mjs";
const reply = (body) => async () => ({
  status: 200,
  ok: true,
  text: async () => JSON.stringify(body),
});
test("release comparison uses numeric stable versions", () => {
  assert.equal(compareVersions("0.75.10", "0.75.8"), 1);
  assert.equal(compareVersions("1.0.0", "0.99.0"), 1);
  assert.equal(compareVersions("0.75.8", "0.75.8"), 0);
  assert.throws(() => compareVersions("0.75.8-pre", "0.75.8"));
});
test("official mac and windows feed shapes produce availability notices", async () => {
  for (const platform of ["darwin", "win32"]) {
    const s = await checkRelease({
      platform,
      arch: "x64",
      currentVersion: "0.75.0",
      fetcher: reply(
        platform === "darwin"
          ? { name: "0.75.8", url: "https://example.test/download" }
          : { version: "0.75.8", url: "https://example.test/download" },
      ),
    });
    assert.equal(s.status, "available");
    assert.equal(s.version, "0.75.8");
    assert.equal(s.url, undefined);
  }
});
test("release requests send no credentials or transcript and use a separate random ID", async () => {
  const urls = [];
  const fetcher = async (url, options) => {
    urls.push(url);
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    assert.equal(options.body, undefined);
    assert.equal(options.headers, undefined);
    return { status: 204, ok: true };
  };
  await checkRelease({
    platform: "darwin",
    arch: "arm64",
    currentVersion: "0.75.0",
    fetcher,
  });
  await checkRelease({
    platform: "darwin",
    arch: "arm64",
    currentVersion: "0.75.0",
    fetcher,
  });
  assert.notEqual(urls[0], urls[1]);
  assert.match(
    urls[0],
    /^https:\/\/api2\.cursor\.sh\/updates\/api\/update\/darwin-arm64\/sand\/0\.75\.0\/[a-f0-9-]{36}\/stable$/,
  );
});
test("network failures and changed formats are unavailable, never up to date", async () => {
  for (const fetcher of [
    async () => {
      throw new Error("offline");
    },
    reply({ unexpected: true }),
    async () => ({ status: 503, ok: false }),
  ]) {
    const s = await checkRelease({
      platform: "win32",
      currentVersion: "0.75.0",
      fetcher,
    });
    assert.equal(s.status, "unavailable");
    assert.equal(s.version, null);
  }
});
test("a release offered to an unknown installation does not imply installed version", async () => {
  const s = await checkRelease({
    platform: "darwin",
    currentVersion: null,
    fetcher: reply({ name: "0.75.8" }),
  });
  assert.equal(s.currentVersion, null);
  assert.match(s.message, /not detected/);
});
test("no-update response is scoped to the official offer", async () => {
  const s = await checkRelease({
    platform: "darwin",
    currentVersion: "0.75.8",
    fetcher: async () => ({ status: 204, ok: true }),
  });
  assert.equal(s.status, "current");
  assert.match(s.message, /offered/);
});
