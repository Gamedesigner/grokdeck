import test from "node:test";
import http from "node:http";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createBridge, loadPairingToken } from "../bridge/server.mjs";
const snapshot = {
  agents: [
    {
      id: "agent-1",
      name: "Test Agent",
      messages: [
        { id: "m1", role: "assistant", content: "Cached text", timestamp: 1 },
      ],
      preview: "A preview",
      cachedAt: 1,
    },
  ],
  sections: [],
  source: {
    available: true,
    path: "/private/source",
    version: "0.75.0",
    checkedAt: 1,
    cacheUpdatedAt: 1,
    warning: null,
  },
  warnings: [],
};
async function start(t, reader = async () => snapshot) {
  const token = randomBytes(32).toString("base64url");
  const server = createBridge({ token, reader });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    headers: { Authorization: `Bearer ${token}` },
    token,
  };
}
test("all data and health routes require a correct pairing credential", async (t) => {
  const { url, headers } = await start(t);
  for (const route of [
    "/v1/health",
    "/v1/agents",
    "/v1/agents/agent-1/messages",
  ]) {
    assert.equal((await fetch(url + route)).status, 401);
    assert.equal(
      (await fetch(url + route, { headers: { Authorization: "Bearer wrong" } }))
        .status,
      401,
    );
    assert.equal((await fetch(url + route, { headers })).status, 200);
  }
});
test("roster does not export transcripts or host filesystem paths", async (t) => {
  const { url, headers } = await start(t);
  const body = await (await fetch(url + "/v1/agents", { headers })).json();
  assert.equal(body.apiVersion, 1);
  assert.equal(body.agents[0].messageCount, 1);
  assert.equal(body.agents[0].messages, undefined);
  assert.equal(body.source.path, undefined);
});
test("conversation reads are scoped to the current account and read-only", async (t) => {
  const { url, headers } = await start(t);
  const body = await (
    await fetch(url + "/v1/agents/agent-1/messages", { headers })
  ).json();
  assert.equal(body.messages[0].content, "Cached text");
  assert.equal(
    (await fetch(url + "/v1/agents/other-account/messages", { headers }))
      .status,
    404,
  );
  assert.equal(
    (await fetch(url + "/v1/agents", { method: "POST", headers, body: "{}" }))
      .status,
    405,
  );
  assert.equal(
    (await fetch(url + "/v1/agents?token=wrong", { headers })).status,
    400,
  );
});
test("browser origins and foreign Host headers cannot read a paired bridge", async (t) => {
  const { url, headers } = await start(t);
  assert.equal(
    (
      await fetch(url + "/v1/agents", {
        headers: { ...headers, Origin: "https://example.test" },
      })
    ).status,
    403,
  );
  const status = await new Promise((resolve, reject) => {
    const req = http.get(
      url + "/v1/agents",
      { headers: { ...headers, Host: "attacker.example" } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on("error", reject);
  });
  assert.equal(status, 403);
});
test("cache failure does not leak paths or error details", async (t) => {
  const { url, headers } = await start(t, async () => {
    throw new Error("/private/secret");
  });
  const r = await fetch(url + "/v1/agents", { headers });
  assert.equal(r.status, 503);
  assert.ok(!(await r.text()).includes("/private"));
});
test("pairing credential is generated once, kept private, and never follows symlinks", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "grokdeck-pairing-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const a = await loadPairingToken(root),
    b = await loadPairingToken(root);
  assert.equal(a.token, b.token);
  assert.equal(a.token.length, 43);
  if (process.platform !== "win32")
    assert.equal((await fs.stat(a.file)).mode & 0o777, 0o600);
  if (process.platform !== "win32") {
    await fs.unlink(a.file);
    await fs.symlink(path.join(root, "missing"), a.file);
    await assert.rejects(() => loadPairingToken(root));
  }
});
