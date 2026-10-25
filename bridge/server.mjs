import http from "node:http";
import { timingSafeEqual, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { readCache } from "../desktop/cache.mjs";

export const DEFAULT_PORT = 43872;
export function authorized(header, token) {
  if (
    typeof header !== "string" ||
    header.length > 256 ||
    !header.startsWith("Bearer ")
  )
    return false;
  const actual = Buffer.from(header.slice(7)),
    expected = Buffer.from(token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export async function loadPairingToken(
  directory = path.join(os.homedir(), ".grokdeck-bridge"),
) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, "pairing-token");
  try {
    const value = randomBytes(32).toString("base64url");
    await fs.writeFile(file, value, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128)
    throw new Error("Invalid pairing credential file");
  const token = (await fs.readFile(file, "utf8")).trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new Error("Invalid pairing credential");
  if (process.platform !== "win32") await fs.chmod(file, 0o600);
  return { token, file };
}
export function createBridge({
  token,
  sourcePath,
  reader = () => readCache(sourcePath),
} = {}) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new Error("A 256-bit pairing token is required");
  const server = http.createServer(async (req, res) => {
    const respond = (status, body) => {
      let raw = JSON.stringify(body);
      if (Buffer.byteLength(raw) > 8 * 1024 * 1024) {
        status = 413;
        raw = JSON.stringify({
          error: "Cached discussion is too large for this prototype.",
        });
      }
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
        Connection: "close",
      });
      res.end(raw);
    };
    const port = server.address()?.port;
    const hosts = new Set([
      `127.0.0.1:${port}`,
      `localhost:${port}`,
      `[::1]:${port}`,
    ]);
    if (!hosts.has(req.headers.host?.toLowerCase()) || req.headers.origin)
      return respond(403, {
        error: "Only native loopback clients are accepted.",
      });
    if (!authorized(req.headers.authorization, token))
      return respond(401, { error: "Pairing required." });
    if (req.method !== "GET")
      return respond(405, { error: "This bridge is read-only." });
    let url;
    try {
      url = new URL(req.url, "http://127.0.0.1");
    } catch {
      return respond(400, { error: "Invalid request." });
    }
    if (url.search)
      return respond(400, {
        error:
          "Query parameters are not supported. Send pairing credentials only in the Authorization header.",
      });
    if (url.pathname === "/v1/health")
      return respond(200, {
        apiVersion: 1,
        name: "GrokDeck Bridge",
        readOnly: true,
      });
    const conversation = url.pathname.match(
      /^\/v1\/agents\/([A-Za-z0-9_-]{1,128})\/messages$/,
    );
    if (url.pathname !== "/v1/agents" && !conversation)
      return respond(404, { error: "Unknown endpoint." });
    try {
      const snapshot = await reader();
      const { source } = snapshot;
      const metadata = {
        kind: "desktop-cache",
        available: source.available,
        checkedAt: source.checkedAt,
        version: source.version,
        cacheUpdatedAt: source.cacheUpdatedAt,
        warning: source.warning,
      };
      if (!source.available)
        return respond(503, {
          error:
            "Grok Bot cache is unavailable on the host. Open Grok Bot there and sign in.",
        });
      if (conversation) {
        const agent = snapshot.agents.find((a) => a.id === conversation[1]);
        if (!agent)
          return respond(404, {
            error: "Agent not found in the active account cache.",
          });
        return respond(200, {
          apiVersion: 1,
          agentId: agent.id,
          name: agent.name,
          cachedAt: agent.cachedAt,
          messages: agent.messages,
          source: metadata,
        });
      }
      return respond(200, {
        apiVersion: 1,
        agents: snapshot.agents.map(({ messages, ...agent }) => ({
          ...agent,
          messageCount: messages.length,
        })),
        sections: snapshot.sections,
        source: metadata,
        warnings: snapshot.warnings,
      });
    } catch {
      return respond(503, {
        error:
          "Could not read the host cache. Try again after refreshing Grok Bot.",
      });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}
export async function startBridge({
  port = DEFAULT_PORT,
  credentialDirectory,
  sourcePath,
} = {}) {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535)
    throw new Error("Invalid port");
  const { token, file } = await loadPairingToken(credentialDirectory);
  const server = createBridge({ token, sourcePath });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return { server, tokenFile: file, port: server.address().port };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  startBridge({
    port: process.env.GROKDECK_BRIDGE_PORT
      ? Number(process.env.GROKDECK_BRIDGE_PORT)
      : DEFAULT_PORT,
    sourcePath: process.env.GROKDECK_SOURCE,
    credentialDirectory: process.env.GROKDECK_BRIDGE_CONFIG,
  })
    .then(({ server, tokenFile, port }) => {
      console.log(`GrokDeck read-only bridge: http://127.0.0.1:${port}`);
      console.log(
        `Pairing credential stored locally at ${tokenFile}; its value is never logged.`,
      );
      console.log(
        "Loopback only. Physical iPhone access requires a separately configured private HTTPS connection.",
      );
      for (const signal of ["SIGINT", "SIGTERM"])
        process.on(signal, () => server.close(() => process.exit(0)));
    })
    .catch(() => {
      console.error(
        "Could not start the bridge. Check the port and local credential file permissions.",
      );
      process.exitCode = 1;
    });
}
