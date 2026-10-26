import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fixture, stream } from "./helpers/api-fixture.mjs";

const post = (f, route, body, headers = f.headers) => fetch(
  f.status.baseUrl.replace(/\/v1$/, "") + route,
  { method: "POST", headers, body: JSON.stringify(body) },
);
const textRequest = { model: "fast-model", messages: [{ role: "user", content: "hello" }] };
const toolStream = () => new Response([
  { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_lookup", type: "function", function: { name: "lookup", arguments: '{"x":' } }] } }] },
  { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "1}" } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } },
].map(v => "data: " + JSON.stringify(v) + "\n\n").join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });

test("Chat accepts SDK metadata and clamps oversized output budgets without forwarding local-only fields", async t => {
  const f = await fixture(t);
  const r = await post(f, "/chat/completions/", { ...textRequest, max_tokens: 32000, metadata: { client: "agent" }, store: false, service_tier: "auto", logprobs: false });
  assert.equal(r.status, 200);
  const sent = JSON.parse(f.calls[0].options.body);
  assert.equal(sent.max_tokens, 4096);
  assert.equal(sent.metadata, undefined);
  assert.equal(sent.store, undefined);
});
test("zero balances are skipped, but stale zeros and unknown balances can be rechecked by upstream", async t => {
  const f = await fixture(t);
  f.stores.get("workbuddy").records[0].profile.quota = { remaining: 0, fetchedAt: Date.now() };
  assert.equal((await f.send()).status, 200);
  assert.equal(f.calls[0].options.headers["X-User-Id"], "b");
  f.stores.get("workbuddy").records[1].profile.quota = { remaining: 0, fetchedAt: Date.now() };
  assert.equal((await f.send({ conversation_id: "empty" })).status, 503);
  assert.equal(f.calls.length, 1);
  f.stores.get("workbuddy").records[0].profile.quota.fetchedAt -= 3600000;
  assert.equal((await f.send({ conversation_id: "stale" })).status, 200);
});
for (const business of [false, true]) test("definite exhausted credits fail over once in the same region" + (business ? " (business-code response)" : " (HTTP 402)"), async t => {
  const f = await fixture(t, async (_url, options) => options.headers["X-User-Id"] === "a"
    ? Response.json({ code: 14001 }, { status: business ? 200 : 402 }) : stream("available-account"));
  const r = await f.send({ conversation_id: "sticky-empty" });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).choices[0].message.content, "available-account");
  assert.deepEqual(f.calls.map(c => c.options.headers["X-User-Id"]), ["a", "b"]);
  assert.equal((await f.send({ conversation_id: "sticky-empty" })).status, 200);
  assert.equal(f.calls[2].options.headers["X-User-Id"], "b");
  assert.equal(f.gateway.snapshot().recent[0].accountId, "b");
});
test("partial generation followed by exhaustion never replays a potentially billed request", async t => {
  const f = await fixture(t, async () => new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\ndata: {"code":14001}\n\n', {headers: {"content-type": "text/event-stream"}}));
  const r = await f.send();
  assert.equal(r.status, 402);
  assert.equal(f.calls.length, 1);
});
test("current account catalog excludes historical and media models and explicit refresh bypasses cache", async t => {
  let version = 1;
  const f = await fixture(t, async url => Response.json({ code: 0, data: url.endsWith("/v3/config")
    ? {models: [{id:"old-model"}]}
    : { agents: [{ name: "cli", models: ["new-" + version, "video-model"] }], models: [{id:"new-" + version, maxOutputTokens:32000}, {id:"old-model"}, {id:"video-model", tags:["text-to-video"]}] } }));
  let r = await f.gateway.models();
  assert.deepEqual(r.data.map(m=>m.id), ["new-1", "global:new-1"]);
  assert.equal(r.data[0].max_output_tokens, 4096);
  version++;
  assert.equal((await f.gateway.models()).data[0].id, "new-1");
  assert.equal((await f.gateway.models(true)).data[0].id, "new-2");
});
test("Responses accepts full-history agent input, instructions and function results", async t => {
  const f = await fixture(t);
  const r = await post(f, "/v1/responses", { model:"fast-model", instructions:"help", store:false, max_output_tokens:64, reasoning:{effort:"low"}, input:[
    {role:"user",content:[{type:"input_text",text:"lookup"}]},
    {type:"function_call",call_id:"call_prior",name:"lookup",arguments:'{"x":1}'},
    {type:"function_call_output",call_id:"call_prior",output:"found"},
  ], tools:[{type:"function",name:"lookup",parameters:{type:"object"}}] });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.object,"response"); assert.equal(j.status,"completed");
  assert.equal(j.output[0].content[0].text,"private-reply");
  assert.equal(j.usage.input_tokens,7);
  const sent = JSON.parse(f.calls[0].options.body);
  assert.equal(sent.messages[0].role,"system");
  assert.equal(sent.messages.at(-1).tool_call_id,"call_prior");
  assert.equal(sent.tools[0].function.name,"lookup");
  await f.gateway.stop();
  assert.ok(!(await fs.readFile(path.join(f.directory,"api-usage.json"),"utf8")).includes("private-reply"));
});
test("Responses streams typed text events and a final complete response", async t => {
  const f = await fixture(t);
  const r = await post(f,"/responses",{model:"fast-model", input:"hi",stream:true});
  assert.equal(r.status,200);
  const s = await r.text();
  for(const e of ["response.created","response.output_item.added","response.output_text.delta","response.output_text.done","response.output_item.done","response.completed"]) assert.ok(s.includes("event: "+e+"\n"), e);
  assert.ok(!s.includes("[DONE]"));
});
test("Responses streams tool arguments with stable call IDs and correct output indices", async t => {
  const f = await fixture(t,async()=>toolStream());
  const r = await post(f,"/v1/responses",{model:"fast-model",input:"lookup",stream:true});
  assert.equal(r.status,200);
  const s=await r.text();
  assert.match(s,/response.function_call_arguments.delta/);
  const events=s.split("\n").filter(l=>l.startsWith("data: ")).map(l=>JSON.parse(l.slice(6)));
  const done=events.find(e=>e.type==="response.completed").response;
  assert.equal(done.output[0].call_id,"call_lookup");
  assert.equal(done.output[0].arguments,'{"x":1}');
});
test("Messages authenticates x-api-key and maps system/tools/results into the shared gateway", async t => {
  const f=await fixture(t);
  const r=await post(f,"/v1/messages",{model:"fast-model",max_tokens:64,system:[{type:"text",text:"help",cache_control:{type:"ephemeral"}}],messages:[
    {role:"user",content:"lookup"},
    {role:"assistant",content:[{type:"tool_use",id:"toolu_1",name:"lookup",input:{x:1}}]},
    {role:"user",content:[{type:"tool_result",tool_use_id:"toolu_1",content:[{type:"text",text:"found"}]}]},
  ],tools:[{name:"lookup",input_schema:{type:"object"}}]}, {"Content-Type":"application/json","x-api-key":f.gateway.getKey(),"anthropic-version":"2023-06-01"});
  assert.equal(r.status,200);
  const j=await r.json();assert.equal(j.type,"message");assert.equal(j.content[0].text,"private-reply");assert.equal(j.stop_reason,"end_turn");assert.equal(j.usage.output_tokens,3);
  const sent=JSON.parse(f.calls[0].options.body);
  assert.equal(sent.messages.at(-1).tool_call_id,"toolu_1");
});
test("Messages streams tool-use block lifecycle and usage accepted by Anthropic clients", async t => {
  const f=await fixture(t,async()=>toolStream());
  const r=await post(f,"/messages",{model:"fast-model",messages:[{role:"user",content:"lookup"}],max_tokens:64,stream:true});
  assert.equal(r.status,200);
  const s=await r.text();
  for(const e of ["message_start","content_block_start","content_block_delta","content_block_stop","message_delta","message_stop"])assert.ok(s.includes("event: "+e+"\n"),e);
  assert.match(s,/input_json_delta/);assert.match(s,/tool_use/);
  assert.ok(!s.includes("[DONE]"));
});
test("all protocols reject conflicting keys, unsafe images and unsupported hosted tools without upstream requests", async t => {
  const f=await fixture(t);
  assert.equal((await post(f,"/messages",{...textRequest,max_tokens:64},{...f.headers,"x-api-key":"wrong"})).status,401);
  for(const input of [[{role:"user",content:[{type:"input_image",image_url:"file:///etc/passwd"}]}]])assert.equal((await post(f,"/responses",{model:"fast-model",input})).status,400);
  assert.equal((await post(f,"/responses",{model:"fast-model",input:"hi",tools:[{type:"web_search"}]})).status,400);
  assert.equal(f.calls.length,0);
});
