import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync,verify } from "node:crypto";
let EditorOAuth;
try {
  ({ EditorOAuth } = await import("../desktop/editor-oauth.mjs"));
} catch {}
const response = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data,
});
const context = {
  machineId: "fixture-machine",
  deviceId: "fixture-device",
  appVersion: "3.3.95",
  pluginVersion: "2.3.fixture",
  quality: "stable",
  platform: "linux",
  publicKey: generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  }).publicKey,
};
const jwt = (id) =>
  `e30.${Buffer.from(JSON.stringify({ data: { id }, exp: 2000000000 })).toString("base64url")}.fixture`;
test('Trae online probes and preflights stay alive before a credential callback',async t=>{
  const service=new EditorOAuth({port:0,context:async()=>context,request:async()=>{throw new Error('probe must not exchange credentials');}});t.after(()=>service.close());const ticket=await service.start('trae-cn');const flow=service.require(ticket.id,'trae-cn');const callback=new URL(new URL(flow.url).searchParams.get('auth_callback_url'));
  for(const method of ['OPTIONS','GET']) {const response=await fetch(new URL('/',callback),{method,headers:{Origin:'https://www.trae.cn','Access-Control-Request-Private-Network':'true'}});assert.equal(response.status,200);assert.equal(response.headers.get('access-control-allow-origin'),'*');assert.equal(response.headers.get('access-control-allow-private-network'),'true');}
  assert.equal(await service.poll('trae-cn',ticket.id),null);assert.ok(service.require(ticket.id,'trae-cn'));
});
test('Qoder refresh rejects a different user from the official profile endpoint',async()=>{
  const service=new EditorOAuth({context:async()=>context,request:async url=>response(url.endsWith('/userinfo')?{id:'other',name:'other'}:{token:'new-token',refresh_token:'drt-new'})});
  await assert.rejects(service.refresh('qoder-cn',{uid:'42',nickname:'A',token:'old',refreshToken:'drt-old'}),/身份/);
});
test('Trae refresh signs the existing device proof with P1363 and rejects a mismatching UID',async()=>{
  const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1',publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});let body;const service=new EditorOAuth({context:async()=>({...context,...pair}),request:async(_url,options)=>{body=JSON.parse(options.body);return response({Result:{Token:jwt('42'),RefreshToken:'new-refresh'}});}});
  const result=await service.refresh('trae-cn',{uid:'42',nickname:'林',token:'old',refreshToken:'old-refresh'});assert.equal(result.uid,'42');const proof=body.DeviceProof;const message=`POST\n/trae/api/v3/oauth/ExchangeToken\nono9krqynydwx5\nold-refresh\n${proof.Timestamp}\n${proof.Nonce}`;assert.equal(verify('sha256',Buffer.from(message),{key:pair.publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(proof.Signature,'base64')),true);
});
test("Qoder PKCE is held in backend and CN/global API endpoints stay isolated", async () => {
  assert.equal(typeof EditorOAuth, "function", "OAuth not implemented");
  for (const [provider, origin, redirect] of [
    ["qoder-cn", "https://openapi.qoder.com.cn", "qoder-work-cn://"],
    ["qoder-global", "https://openapi.qoder.sh", null],
  ]) {
    const calls = [];
    const service = new EditorOAuth({
      context: async () => context,
      request: async (url, options) => {
        calls.push({ url, options });
        return url.includes("/poll?")
          ? response({
              data: {
                device_token: "fixture-access",
                refresh_token: "drt-fixture",
                expires_in: 60000,
              },
            })
          : response({ id: 81, name: "林" });
      },
    });
    const ticket = await service.start(provider);
    const internal = service.require(ticket.id, provider);
    const url = new URL(internal.url);
    assert.equal(url.searchParams.get("redirect_uri"), redirect);
    assert.equal(
      url.searchParams.get("challenge"),
      createHash("sha256").update(internal.verifier).digest("base64url"),
    );
    assert.equal(JSON.stringify(ticket).includes("verifier"), false);
    const account = await service.poll(provider, ticket.id);
    assert.equal(account.uid, "81");
    assert.equal(account.nickname, "林");
    assert.ok(
      account.expiresAt > Date.now() + 50000 &&
        account.expiresAt < Date.now() + 61000,
      "expires_in is milliseconds",
    );
    assert.ok(calls.every((call) => call.url.startsWith(origin + "/")));
    assert.equal(
      calls[1].options.headers.Authorization,
      "Bearer fixture-access",
    );
    service.cancel(provider, ticket.id);
  }
});
test("pending, canceled, expired and cross-region OAuth cannot persist credentials", async () => {
  assert.equal(typeof EditorOAuth, "function");
  const service = new EditorOAuth({
    context: async () => context,
    request: async () => response({}, 202),
  });
  const ticket = await service.start("qoder-cn");
  assert.equal(await service.poll("qoder-cn", ticket.id), null);
  assert.throws(
    () => service.require(ticket.id, "qoder-global"),
    /不匹配|无效/,
  );
  service.cancel("qoder-cn", ticket.id);
  await assert.rejects(service.poll("qoder-cn", ticket.id), /过期|取消/);
  const second = await service.start("qoder-cn");
  service.require(second.id, "qoder-cn").expiresAt = Date.now() - 1;
  await assert.rejects(service.poll("qoder-cn", second.id), /过期/);
});
test("Qoder refresh routing requires a fresh token and preserves absent refresh values", async () => {
  assert.equal(typeof EditorOAuth, "function");
  const calls = [];
  const service = new EditorOAuth({
    request: async (url, options) => {
      calls.push({ url, options });
      return response({ token: "new-token", expires_in: 90000 });
    },
    context: async () => context,
  });
  const account = await service.refresh("qoder-global", {
    uid: "1",
    nickname: "A",
    token: "old",
    refreshToken: "jrt-previous",
  });
  assert.equal(account.refreshToken, "jrt-previous");
  assert.equal(account.token, "new-token");
  assert.ok(calls[0].url.endsWith("/api/v1/jobToken/refresh"));
  assert.equal(calls[0].options.headers.Authorization, undefined);
  await assert.rejects(
    service.refresh("qoder-cn", {
      uid: "1",
      token: "old",
      refreshToken: "bad",
    }),
    /重新授权/,
  );
  service.request = async () => response({ refresh_token: "drt-new" });
  await assert.rejects(
    service.refresh("qoder-cn", {
      uid: "1",
      token: "old",
      refreshToken: "drt-old",
    }),
    /访问凭据/,
  );
});
test("Trae browser context, callback state, UID and allowlisted token host are checked", async (t) => {
  assert.equal(typeof EditorOAuth, "function");
  let request;
  const service = new EditorOAuth({
    port: 0,
    context: async () => context,
    request: async (url, options) => {
      request = { url, options };
      return response({
        Result: { Token: jwt("42"), RefreshToken: "fixture-refresh" },
      });
    },
  });
  t.after(() => service.close());
  const ticket = await service.start("trae-cn"),
    flow = service.require(ticket.id, "trae-cn"),
    url = new URL(flow.url);
  assert.equal(url.searchParams.get("x_env"), "");
  assert.equal(url.searchParams.get("plugin_version"), context.pluginVersion);
  assert.equal(url.searchParams.get("x_app_version"), context.appVersion);
  const callback = new URL(url.searchParams.get("auth_callback_url"));
  callback.searchParams.set(
    "authCodeInfo",
    JSON.stringify({ AuthCode: "fixture-code" }),
  );
  callback.searchParams.set(
    "userInfo",
    JSON.stringify({ UserID: "42", ScreenName: "明" }),
  );
  callback.searchParams.set("loginTraceID", "wrong");
  assert.equal((await fetch(callback)).status, 400);
  assert.equal(request, undefined);
  callback.searchParams.set("loginTraceID", flow.state);
  callback.searchParams.set("host", "https://attacker.test");
  assert.equal((await fetch(callback)).status, 400);
  assert.equal(request, undefined);
  callback.searchParams.delete("host");
  assert.equal((await fetch(callback)).status, 200);
  const account = await service.poll("trae-cn", ticket.id);
  assert.equal(account.uid, "42");
  const body = JSON.parse(request.options.body);
  assert.equal(body.DeviceInfo.DeviceID, context.deviceId);
  assert.equal(body.IDEVersion, context.appVersion);
  assert.equal(body.DeviceProof, undefined);
  assert.equal(request.options.headers["x-cloudide-token"], "");
  assert.equal(body.CodeVerifier, flow.verifier);
});
test("Trae callback account mismatch fails without exposing raw server fields", async (t) => {
  assert.equal(typeof EditorOAuth, "function");
  const service = new EditorOAuth({
    port: 0,
    context: async () => context,
    request: async () =>
      response({ Result: { Token: jwt("other"), RefreshToken: "secret" } }),
  });
  t.after(() => service.close());
  const ticket = await service.start("trae-global"),
    flow = service.require(ticket.id, "trae-global"),
    callback = new URL(new URL(flow.url).searchParams.get("auth_callback_url"));
  callback.searchParams.set(
    "authCodeInfo",
    JSON.stringify({ AuthCode: "code" }),
  );
  callback.searchParams.set("userInfo", JSON.stringify({ UserID: "42" }));
  callback.searchParams.set("loginTraceID", flow.state);
  await fetch(callback);
  await assert.rejects(service.poll("trae-global", ticket.id), /身份/);
});
