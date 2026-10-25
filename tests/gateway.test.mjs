import test from "node:test";
import assert from "node:assert/strict";
import { createGateway, validateGatewayConnection } from "../bridge/gateway.mjs";

const descriptor = {
  baseUrl: "https://example.us8.cursorvm.com",
  token: "test-token-not-a-credential",
  headers: { "x-anyrun-port-token": "test-port-token" },
  accountScope: "account-a",
};
const nonce = "a3af8bb0-511c-4ca8-85fc-65b1962faedf";
const message = { agentId: "agent-1", prompt: "A local test message", clientNonce: nonce };
const json = (body, options) => new Response(JSON.stringify(body), options);
const create = (fetchImpl, extra = {}) => createGateway({ resolveConnection: async () => descriptor, getAccountScope: async () => descriptor.accountScope, fetchImpl, ...extra });

test("gateway credentials are limited to a validated HTTPS gateway origin", () => {
  for (const baseUrl of [
    "http://example.us8.cursorvm.com", "https://cursorvm.com", "https://cursorvm.com.evil.test",
    "https://example.us8.cursorvm.com@evil.test", "https://example.us8.cursorvm.com/path",
    "https://example.us8.cursorvm.com?token=bad", "https://example.us8.cursorvm.com/#frag",
    "https://example.us8.cursorvm.com:8443", "https://127.0.0.1", "https://evil.test",
  ]) assert.throws(() => validateGatewayConnection({ ...descriptor, baseUrl }), { code: "invalid_response" });
  assert.throws(() => validateGatewayConnection({ ...descriptor, headers: { authorization: "Bearer other" } }));
  assert.throws(() => validateGatewayConnection({ ...descriptor, headers: { "x-anyrun-port-token": "a\r\nx-injected: bad" } }));
  assert.equal(validateGatewayConnection(descriptor).baseUrl, descriptor.baseUrl);
});

test("roster and discussion use exact observed POST methods, headers and direct replies", async () => {
  const requests = [];
  const gateway = create(async (url, options) => {
    requests.push({ url, ...options });
    return url.endsWith("/listAgents") ? json([{ id: "agent-1", name: "Desk" }]) : json({ entries: [{ id: "m1", kind: "message", role: "assistant", content: "Reply" }] });
  });
  assert.deepEqual(await gateway.roster(), [{ id: "agent-1", name: "Desk" }]);
  assert.equal((await gateway.discussion("agent-1")).entries[0].content, "Reply");
  assert.equal(requests[0].url, `${descriptor.baseUrl}/api/listAgents`);
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].redirect, "error");
  assert.equal(requests[0].headers.authorization, `Bearer ${descriptor.token}`);
  assert.equal(requests[0].headers["x-anyrun-port-token"], "test-port-token");
  assert.deepEqual(JSON.parse(requests[1].body), { id: "agent-1", limit: 100 });
});

test("credentials never follow redirects and remote error text is not exposed", async () => {
  const secret = "private-vendor-detail-with-token";
  for (const status of [302, 401, 500]) {
    const gateway = create(async (_, options) => {
      assert.equal(options.redirect, "error");
      return new Response(secret, { status, headers: { location: "https://evil.test" } });
    });
    await assert.rejects(gateway.roster(), (error) => !error.message.includes(secret) && !error.message.includes("evil.test"));
  }
});

test("account switching during a read discards the result", async () => {
  let scope = descriptor.accountScope;
  const gateway = create(async () => { scope = "account-b"; return json([{ id: "agent-1", name: "Old account" }]); }, { getAccountScope: async () => scope });
  await assert.rejects(gateway.roster(), { code: "account_changed" });
});

test("pre-dispatch account mismatch sends no request", async () => {
  let calls = 0;
  const gateway = create(async () => { calls++; return json([]); }, { getAccountScope: async () => "account-b" });
  await assert.rejects(gateway.roster(), { code: "account_changed" });
  assert.equal(calls, 0);
});

test("one bridge request cannot switch accounts between its roster check and send", async () => {
  let scope=descriptor.accountScope,sends=0;
  const gateway=createGateway({
    resolveConnection:async()=>({...descriptor,accountScope:scope}),getAccountScope:async()=>scope,
    fetchImpl:async url=>{if(url.endsWith('/listAgents'))return json([{id:'agent-1',name:'Shared bot'}]);sends++;return json({accepted:true});},
  });
  await assert.rejects(gateway.withAccount(async()=>{
    await gateway.roster();scope='account-b';await gateway.send(message);
  }),{code:'account_changed'});
  assert.equal(sends,0);
  // The old scope is not retained across independent requests.
  assert.equal((await gateway.withAccount(()=>gateway.roster()))[0].name,'Shared bot');
});
test("one bridge request also pins its team when the account stays the same",async()=>{
  let teamId=undefined,sends=0;
  const gateway=createGateway({resolveConnection:async()=>({...descriptor,teamId}),getAccountScope:async()=>descriptor.accountScope,
    fetchImpl:async url=>{if(url.endsWith('/listAgents'))return json([{id:'agent-1',name:'Shared bot'}]);sends++;return json({accepted:true});}});
  await assert.rejects(gateway.withAccount(async()=>{await gateway.roster();teamId='456';await gateway.send(message);}),{code:'account_changed'});
  assert.equal(sends,0);
});

test("same nonce shares one send, including concurrent calls; changed content is refused", async () => {
  let calls = 0, release;
  const gate = new Promise((resolve) => { release = resolve; });
  const gateway = create(async (_, options) => {
    calls++; await gate;
    const sent = JSON.parse(options.body);
    assert.equal(sent.clientNonce, nonce);
    assert.equal(sent.initiator, "user");
    assert.equal(sent.source, "desktop");
    assert.equal(sent.prompt, message.prompt);
    return json({ accepted: true });
  });
  const one = gateway.send(message), two = gateway.send(message);
  release();
  assert.deepEqual(await one, { accepted: true, clientNonce: nonce });
  assert.deepEqual(await two, await one);
  assert.deepEqual(await gateway.send(message), await one);
  await assert.rejects(gateway.send({ ...message, prompt: "Different content" }), { code: "nonce_reused" });
  assert.equal(calls, 1);
});

test("uncertain send is never automatically replayed or evicted", async () => {
  let calls = 0;
  const gateway = create(async () => { calls++; throw new Error("token-with-private-url"); }, { maxReceipts: 1 });
  for (let i = 0; i < 2; i++) await assert.rejects(gateway.send(message), (error) => error.code === "unknown_delivery" && error.clientNonce === nonce && !error.message.includes("token-with-private-url"));
  await assert.rejects(gateway.send({ ...message, clientNonce: "b3af8bb0-511c-4ca8-85fc-65b1962faedf" }), { code: "receipt_limit" });
  assert.equal(calls, 1);
});

test("server failure or malformed acceptance does not become a successful send", async () => {
  for (const response of [() => new Response("error", { status: 500 }), () => json({}), () => json(null), () => json({ accepted: "yes" })]) {
    const gateway = create(async () => response());
    await assert.rejects(gateway.send(message), { code: "unknown_delivery" });
  }
  assert.deepEqual(await create(async () => json({ accepted: false })).send(message), { accepted: false, clientNonce: nonce });
});

test("acceptance checks host account slot, agent and nonce without sending again", async () => {
  let calls = 0;
  const gateway = create(async (url, options) => {
    calls++;
    assert.ok(url.endsWith("/promptAcceptanceStatus"));
    assert.deepEqual(JSON.parse(options.body), { accountSlot: "host", agentId: "agent-1", clientNonce: nonce, firstSentAtMs: 1234 });
    return json({ outcome: "found", record: { accountSlot: "host", agentId: "agent-1", clientNonce: nonce, status: "accepted" } });
  });
  assert.equal((await gateway.acceptance({ agentId: "agent-1", clientNonce: nonce, firstSentAtMs: 1234 })).record.status, "accepted");
  assert.equal(calls, 1);
  const wrongAgent = create(async () => json({ outcome: "found", record: { accountSlot: "host", agentId: "another-agent", clientNonce: nonce, status: "accepted" } }));
  await assert.rejects(wrongAgent.acceptance({ agentId: "agent-1", clientNonce: nonce }), { code: "invalid_response" });
});

test("reply limits and method-specific shapes reject oversized or malformed data", async () => {
  const cases = [
    () => new Response("{}", { headers: { "content-length": String(8 * 1024 * 1024 + 1) } }),
    () => new Response(" ".repeat(8 * 1024 * 1024 + 1)),
    () => json({ agents: [] }),
    () => new Response("invalid JSON"),
    () => json([{ id: "../escape", name: "Bad" }]),
  ];
  for (const response of cases) await assert.rejects(create(async () => response()).roster(), { code: "invalid_response" });
  await assert.rejects(create(async () => json({ entries: null })).discussion("agent-1"), { code: "invalid_response" });
});

test("invalid send input and agent IDs never reach the network", async () => {
  const gateway = create(async () => { throw new Error("Network should not be called"); });
  for (const patch of [{ prompt: " " }, { prompt: "x".repeat(50001) }, { clientNonce: "reuse-me" }, { agentId: "../other" }]) await assert.rejects(gateway.send({ ...message, ...patch }), { code: "invalid_request" });
  await assert.rejects(gateway.discussion("../other"), { code: "invalid_request" });
});

test("interrupt validates the observed reply and contains no arbitrary command path", async () => {
  const gateway = create(async (url, options) => {
    assert.equal(url, `${descriptor.baseUrl}/api/interruptAgentRun`);
    assert.deepEqual(JSON.parse(options.body), { id: "agent-1" });
    return json({ hadActiveRun: true });
  });
  assert.deepEqual(await gateway.interrupt("agent-1"), { hadActiveRun: true });
});
test('reply sends preserve Unicode and bind the nonce to reply context',async()=>{
 const bodies=[];const gateway=create(async(_,options)=>{bodies.push(JSON.parse(options.body));return json({accepted:true});});
 await gateway.send({...message,prompt:'👍🙂❤️',replyToId:'message-1',replyQuote:'A reply 🙂'});
 assert.equal(bodies[0].prompt,'👍🙂❤️');assert.equal(bodies[0].replyToId,'message-1');assert.equal(bodies[0].replyQuote,'A reply 🙂');
 await assert.rejects(gateway.send({...message,prompt:'👍🙂❤️',replyToId:'message-2',replyQuote:'Other'}),{code:'nonce_reused'});
 assert.equal(bodies.length,1);
});
