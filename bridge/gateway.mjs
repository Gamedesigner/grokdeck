import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

const MAX_REPLY = 8 * 1024 * 1024;
const NONCE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AGENT = /^[A-Za-z0-9_-]{1,128}$/;
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export class GatewayError extends Error {
  constructor(code, message, { status, clientNonce } = {}) {
    super(message);
    this.name = "GatewayError";
    this.code = code;
    if (status !== undefined) this.status = status;
    if (clientNonce !== undefined) this.clientNonce = clientNonce;
  }
}
function invalid(message = "The gateway returned an unsupported response.") {
  return new GatewayError("invalid_response", message);
}
export function validateGatewayConnection(value) {
  if (!record(value) || typeof value.baseUrl !== "string" || typeof value.accountScope !== "string" || value.accountScope.length < 1)
    throw new GatewayError("unavailable", "A signed-in gateway connection is required.");
  let url;
  try { url = new URL(value.baseUrl); } catch { throw invalid("The gateway address is not supported."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
    (url.port && url.port !== "443") || url.pathname !== "/" ||
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+cursorvm\.com$/i.test(url.hostname))
    throw invalid("The gateway address is not supported.");
  const headers = { "content-type": "application/json", "x-sand-slim-avatars": "1" };
  if (value.token !== undefined) {
    if (typeof value.token !== "string" || !value.token.length || value.token.length > 16384 || /[\r\n]/.test(value.token)) throw invalid();
    headers.authorization = `Bearer ${value.token}`;
  }
  if (value.headers !== undefined) {
    if (!record(value.headers)) throw invalid();
    for (const [name, field] of Object.entries(value.headers)) {
      if (!["x-anyrun-network-token", "x-anyrun-port-token"].includes(name.toLowerCase()) ||
        typeof field !== "string" || !field.length || field.length > 16384 || /[\r\n]/.test(field)) throw invalid();
      headers[name.toLowerCase()] = field;
    }
  }
  if (!headers.authorization && !headers["x-anyrun-network-token"] && !headers["x-anyrun-port-token"]) throw invalid();
  if(value.teamId!==undefined&&(typeof value.teamId!=="string"||!/^\d{1,32}$/.test(value.teamId)))throw invalid();
  return { baseUrl: url.origin, headers, accountScope: value.accountScope, teamId:value.teamId, accountSlot: value.accountSlot ?? "host" };
}
function agentId(id) {
  if (typeof id !== "string" || !AGENT.test(id)) throw new GatewayError("invalid_request", "Choose a valid agent.");
  return id;
}
function nonceId(nonce) {
  if (typeof nonce !== "string" || !NONCE.test(nonce)) throw new GatewayError("invalid_request", "A unique UUID is required for each message.");
  return nonce;
}
async function readReply(response) {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_REPLY)) throw invalid();
  if (!response.body) throw invalid();
  const reader = response.body.getReader(), chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_REPLY) { await reader.cancel(); throw invalid(); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw invalid(); }
}

// Original adapter for the observed 0.75.0 JSON gateway protocol. No vendor code is
// loaded or executed. Connection credentials are used only in this host process.
export function createGateway({ resolveConnection, getAccountScope, fetchImpl = fetch, timeoutMs = 15000, maxReceipts = 1000 } = {}) {
  if (typeof resolveConnection !== "function" || typeof fetchImpl !== "function") throw new TypeError("A connection resolver and fetch implementation are required.");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000 || !Number.isInteger(maxReceipts) || maxReceipts < 1) throw new TypeError("Invalid gateway limits.");
  const receipts = new Map();
  const requestAccount = new AsyncLocalStorage();
  const resolve = async () => {
    try {
      const connection=validateGatewayConnection(await resolveConnection());
      const expected=requestAccount.getStore();
      if(expected!==undefined&&(connection.accountScope!==expected.accountScope||connection.teamId!==expected.teamId))throw new GatewayError("account_changed", "The signed-in account or team changed. Reconnect before continuing.");
      return connection;
    }
    catch (error) { if (error instanceof GatewayError) throw error; throw new GatewayError("unavailable", "Open Grok Bot on this Mac and sign in before connecting."); }
  };
  const ensureScope = async (connection) => {
    let current;
    try { current = getAccountScope ? await getAccountScope() : (await resolve()).accountScope; }
    catch { throw new GatewayError("account_changed", "The signed-in account could not be verified. Reconnect before continuing."); }
    if (current !== connection.accountScope) throw new GatewayError("account_changed", "The signed-in account changed. Reconnect before continuing.");
    // A route-scoped request also pins the selected team. A cheap account-only
    // callback cannot detect a same-account team switch, so re-read the session
    // through the resolver (its discovery route is cached by account + team).
    if(requestAccount.getStore()!==undefined)await resolve();
  };
  const request = async (connection, method, args, {timeout=timeoutMs,signal}={}) => {
    await ensureScope(connection);
    let response;
    try {
      response = await fetchImpl(`${connection.baseUrl}/api/${method}`, {
        method: "POST", headers: connection.headers, body: JSON.stringify(args),
        redirect: "error", signal: signal?AbortSignal.any([signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout),
      });
    } catch { throw new GatewayError("transport", "The gateway connection was interrupted."); }
    await ensureScope(connection);
    if (response.redirected || response.status >= 300 && response.status < 400) throw new GatewayError("transport", "The gateway attempted an unsupported redirect.");
    if (!response.ok) {
      // Do not include the vendor response body, URL, or credential in errors.
      await response.body?.cancel().catch(() => {});
      throw new GatewayError(response.status === 401 || response.status === 403 ? "unauthorized" : "gateway_rejected", "The gateway could not complete this request. Check Grok Bot on the Mac.", { status: response.status });
    }
    const reply = await readReply(response);
    await ensureScope(connection);
    return reply;
  };
  const command = async (method, args, validate, options) => {
    const connection = await resolve();
    const result = await request(connection, method, args, options);
    if (!validate(result)) throw invalid();
    return result;
  };
  const api = {
    async withAccount(callback) {
      if(typeof callback!=="function")throw new TypeError("An account-scoped callback is required.");
      const connection=await resolve();
      return requestAccount.run({accountScope:connection.accountScope,teamId:connection.teamId}, callback);
    },
    async roster({signal,timeoutMs:readTimeout=timeoutMs}={}) {
      return command("listAgents", {}, (r) => Array.isArray(r) && r.length <= 10000 && r.every((a) => record(a) && typeof a.id === "string" && AGENT.test(a.id) && typeof a.name === "string"),{signal,timeout:readTimeout});
    },
    async discussion(id) {
      return command("getAgentTranscriptTail", { id: agentId(id), limit: 100 }, (r) => record(r) && Array.isArray(r.entries) && r.entries.length <= 10000 && r.entries.every(record));
    },
    async send({ agentId: id, prompt, clientNonce, replyToId, replyQuote } = {}) {
      agentId(id); nonceId(clientNonce);
      if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 50000) throw new GatewayError("invalid_request", "Enter a message of up to 50,000 characters.");
      const connection = await resolve();
      if(replyToId!==undefined && (typeof replyToId!=='string'||!replyToId.length||replyToId.length>256||typeof replyQuote!=='string'||replyQuote.length>2000))throw new GatewayError('invalid_request','Invalid reply context.');
      if(replyQuote!==undefined && replyToId===undefined)throw new GatewayError('invalid_request','Reply target required.');
      const replyContext=replyToId===undefined?{}:{replyToId,replyQuote};
      const key = `${connection.accountScope}:${clientNonce}`;
      const digest = createHash("sha256").update(JSON.stringify({ agentId: id, prompt, ...replyContext })).digest("hex");
      const previous = receipts.get(key);
      if (previous) {
        if (previous.digest !== digest) throw new GatewayError("nonce_reused", "This message identifier was already used for different content.");
        return previous.promise;
      }
      // Never evict an uncertain send and thereby permit an accidental resend.
      if (receipts.size >= maxReceipts) throw new GatewayError("receipt_limit", "This bridge session has reached its message limit. Review pending sends before restarting it.");
      const pending = { digest, state: "pending", agentId: id, clientNonce };
      pending.promise = (async () => {
        try {
          const result = await request(connection, "sendPrompt", { agentId: id, prompt, clientNonce, source: "desktop", initiator: "user", firstSentAtMs: Date.now(), ...replyContext });
          if (!record(result) || typeof result.accepted !== "boolean") throw invalid();
          pending.state = result.accepted ? "accepted" : "rejected";
          return { accepted: result.accepted, clientNonce };
        } catch (error) {
          const definitelyRejected = error instanceof GatewayError && error.code === "unauthorized" || error instanceof GatewayError && error.code === "gateway_rejected" && error.status >= 400 && error.status < 500;
          pending.state = definitelyRejected ? "rejected" : "unknown";
          if (definitelyRejected) throw error;
          throw new GatewayError("unknown_delivery", "Delivery is uncertain. Check this message’s acceptance status before sending anything again.", { clientNonce });
        }
      })();
      receipts.set(key, pending);
      return pending.promise;
    },
    async acceptance({ agentId: id, clientNonce, firstSentAtMs } = {}) {
      agentId(id); nonceId(clientNonce);
      if (firstSentAtMs !== undefined && (!Number.isSafeInteger(firstSentAtMs) || firstSentAtMs < 0)) throw new GatewayError("invalid_request", "Invalid message timestamp.");
      const connection = await resolve();
      const result = await request(connection, "promptAcceptanceStatus", {
        accountSlot: connection.accountSlot, agentId: id, clientNonce,
        ...(firstSentAtMs === undefined ? {} : { firstSentAtMs }),
      });
      if (!record(result) || !["found", "not-found", "unknown-durability"].includes(result.outcome)) throw invalid();
      if (result.outcome === "found") {
        const r = result.record;
        if (!record(r) || r.clientNonce !== clientNonce || r.agentId !== id || r.accountSlot !== connection.accountSlot || !["accepted", "pending", "rejected"].includes(r.status)) throw invalid();
        const receipt = receipts.get(`${connection.accountScope}:${clientNonce}`);
        if (receipt) receipt.state = r.status;
      }
      return result;
    },
    async interrupt(id) {
      return command("interruptAgentRun", { id: agentId(id) }, (r) => record(r) && typeof r.hadActiveRun === "boolean");
    },
    async computer(id,{signal}={}) {
      const target=agentId(id);
      return command("getForeverBoxStatus", { id:target }, (r) => r===null || record(r) && r.agentId===target &&
        ["absent","hibernated","running"].includes(r.state) && (r.vncUrl===null||typeof r.vncUrl==="string") &&
        (r.windows===undefined||Array.isArray(r.windows)&&r.windows.length<=64&&r.windows.every(w=>record(w)&&Number.isSafeInteger(w.windowIndex)&&w.windowIndex>=0&&w.windowIndex<=63&&typeof w.vncUrl==="string")),{signal,timeout:2000});
    },
    async avatar(id) {
      return command("getAgentAvatar", {id:agentId(id)}, r=>record(r)&&(r.dataUrl===null||typeof r.dataUrl==="string"&&r.dataUrl.length<=350000)&&(r.version===null||typeof r.version==="string"));
    },
    async status() {
      const connection = await resolve();
      await ensureScope(connection);
      return { available: true, transport: "gateway", supportedVersion: "0.75.0" };
    },
  };
  return api;
}
