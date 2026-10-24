import { createServer } from "node:http";
import { randomBytes, randomUUID, createHash, sign } from "node:crypto";
import os from "node:os";
import { editorDefinition } from "./client-registry.mjs";
import { expiry, jwtClaims } from "./credential-codecs.mjs";
const text = (value) =>
  typeof value === "string"
    ? value
    : typeof value === "number"
      ? String(value)
      : "";
function identity(uid, nickname, token, refreshToken, expiresAt, user = {}) {
  uid = text(uid).trim();
  if (!uid || uid.length > 200 || /[\x00-\x1f]/.test(uid))
    throw new Error("授权服务没有返回有效账号身份。");
  if (typeof token !== "string" || !token || token.length > 100000)
    throw new Error("授权服务没有返回有效访问凭据。");
  return {
    uid,
    nickname: text(nickname).slice(0, 80) || "账号",
    token,
    refreshToken: text(refreshToken),
    expiresAt,
    user,
  };
}
function qoderToken(data, previous = {}) {
  const raw = data?.data || data || {},
    token = raw.token || raw.device_token || raw.access_token;
  if (typeof token !== "string" || !token)
    throw new Error("授权服务没有返回新的访问凭据，请重新授权。");
  const duration = Number(raw.expires_in);
  return {
    ...previous,
    token,
    refreshToken: text(raw.refresh_token) || previous.refreshToken || "",
    expiresAt:
      Number.isFinite(duration) && duration > 0
        ? Date.now() + duration
        : expiry(raw.expires_at),
  };
}
function traeToken(data, info, previous = {}) {
  const raw = data?.Result || data?.data || data?.Data || data || {};
  const token =
    raw.Token ||
    raw.AccessToken ||
    raw.access_token ||
    raw.token ||
    raw.Jwt ||
    raw.JWT;
  const claims = jwtClaims(token || ""),
    uid = text(claims?.data?.id || info?.UserID || previous.uid);
  if (
    (info?.UserID && text(info.UserID) !== uid) ||
    (previous.uid && previous.uid !== uid)
  )
    throw new Error("授权返回的账号身份不一致，已停止保存。");
  return identity(
    uid,
    info?.ScreenName || previous.nickname || claims?.data?.name,
    token,
    raw.RefreshToken || raw.refresh_token || previous.refreshToken,
    expiry(raw.ExpiredAt || raw.ExpiresAt || raw.expired_at) ||
      expiry(claims?.exp),
    info || previous.user,
  );
}
export class EditorOAuth {
  flows = new Map();
  constructor({ request = fetch, context, port = 17388 }) {
    Object.assign(this, { request, context, port });
  }
  async json(url, options = {}) {
    let response;
    try {
      response = await this.request(url, {
        ...options,
        redirect: "error",
        signal: options.signal || AbortSignal.timeout(15000),
        headers: { "Content-Type": "application/json", ...options.headers },
      });
    } catch {
      throw new Error("无法连接官方授权服务，请检查网络后重试。");
    }
    if ([202, 404].includes(response.status) && options.pending) return null;
    if (!response.ok)
      throw new Error(
        `官方授权服务返回 HTTP ${response.status}，请稍后重试或重新授权。`,
      );
    try {
      if (response.text) {
        const raw = await response.text();
        if (raw.length > 2 * 1024 * 1024) throw new Error("oversize");
        return JSON.parse(raw);
      }
      return await response.json();
    } catch {
      throw new Error("官方授权服务返回的资料无法识别。");
    }
  }
  require(id, provider) {
    editorDefinition(provider);
    const flow = this.flows.get(id);
    if (!flow || flow.expiresAt <= Date.now()) {
      if (flow) this.cancel(provider, id);
      throw new Error("授权请求已过期或取消，请重新开始。");
    }
    if (flow.provider !== provider)
      throw new Error("授权请求的客户端或地区不匹配。");
    return flow;
  }
  cancel(provider, id) {
    const flow = this.flows.get(id);
    if (!flow) return;
    if (flow.provider !== provider) throw new Error("授权请求的地区不匹配。");
    flow.abort.abort();
    clearTimeout(flow.timer);
    flow.server?.close();
    this.flows.delete(id);
  }
  close() {
    for (const flow of [...this.flows.values()])
      this.cancel(flow.provider, flow.id);
  }
  async start(provider) {
    const definition = editorDefinition(provider);
    for (const flow of this.flows.values())
      if (flow.provider === provider) this.cancel(provider, flow.id);
    const context = await this.context(provider);
    if (!context?.machineId)
      throw new Error("请先打开该客户端完成初始化，再发起网页登录。");
    const flow = {
      id: randomUUID(),
      provider,
      definition,
      context,
      state: randomUUID(),
      verifier: randomBytes(48).toString("base64url"),
      expiresAt: Date.now() + 300000,
      abort: new AbortController(),
      result: null,
      error: null,
      polling: false,
    };
    const challenge = createHash("sha256")
      .update(flow.verifier)
      .digest("base64url");
    if (definition.product === "qoder") {
      flow.nonce =
        definition.region === "cn"
          ? randomUUID()
          : randomUUID().replaceAll("-", "");
      const url = new URL("/device/selectAccounts", definition.origin);
      for (const [key, value] of Object.entries({
        challenge,
        challenge_method: "S256",
        nonce: flow.nonce,
        client_id: definition.authClientId,
        machine_id: context.machineId,
        ...(definition.authRedirect
          ? { redirect_uri: definition.authRedirect }
          : {}),
      }))
        url.searchParams.set(key, value);
      flow.url = url.toString();
    } else {
      if (
        !context.deviceId ||
        !context.publicKey ||
        !context.appVersion ||
        !context.pluginVersion
      )
        throw new Error("Trae 初始化资料不完整，请先正常启动客户端后重试。");
      if (
        [...this.flows.values()].some(
          (item) => item.definition.product === "trae",
        )
      )
        throw new Error("已有 Trae 授权正在进行，请完成或取消后再切换地区。");
      const server = createServer(
        (req, res) => void this.callback(flow, req, res),
      );
      flow.server = server;
      await new Promise((resolve, reject) => {
        server.once("error", () =>
          reject(new Error("本地授权端口被占用，请结束其他 Trae 登录后重试。")),
        );
        server.listen(this.port, "127.0.0.1", resolve);
      });
      const callback = `http://127.0.0.1:${server.address().port}/authorize`;
      flow.callbackOrigin = new URL(callback).origin;
      const device = this.deviceInfo(context),
        url = new URL("/authorization", definition.origin);
      const params = {
        login_version: "1",
        login_channel: "native_ide",
        plugin_version: context.pluginVersion,
        auth_type: "local",
        redirect: "0",
        login_trace_id: flow.state,
        auth_callback_url: callback,
        machine_id: context.machineId,
        device_id: context.deviceId,
        x_device_id: context.deviceId,
        x_machine_id: context.machineId,
        x_device_brand: device.DeviceModel,
        x_device_type: device.OSInfo,
        x_os_version: device.OSVersion,
        x_env: "",
        x_app_version: context.appVersion,
        x_app_type: context.quality || "stable",
        code_challenge: challenge,
        code_challenge_method: "S256",
        channel_name: "common",
        auth_from: "trae",
        client_id: definition.authClientId,
      };
      for (const [key, value] of Object.entries(params))
        url.searchParams.set(key, value);
      flow.url = url.toString();
    }
    flow.timer = setTimeout(() => this.cancel(provider, flow.id), 300000);
    flow.timer.unref();
    this.flows.set(flow.id, flow);
    return { id: flow.id, provider, expiresAt: flow.expiresAt };
  }
  deviceInfo(context) {
    return {
      DeviceID: context.deviceId,
      MachineID: context.machineId,
      PlatformCode: "IDE_PC",
      DeviceType: "PC",
      DeviceName: os.hostname(),
      DeviceModel: context.deviceModel || os.machine(),
      ClientVersion: context.appVersion,
      DevicePublicKey: context.publicKey,
      DeviceBrand: context.deviceBrand || "",
      DeviceCPU: os.cpus()[0]?.model || "",
      OSInfo:
        context.platform === "darwin"
          ? "mac"
          : context.platform === "win32"
            ? "windows"
            : "linux",
      OSVersion: context.osVersion || os.release(),
    };
  }
  async callback(flow, req, res) {
    const send = (status, message) => {
      res.writeHead(status, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'",
        "X-Content-Type-Options": "nosniff",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Private-Network": "true",
      });
      res.end(
        `<html lang="zh-CN"><meta charset="utf-8"><title>WorkBuddy Switch</title><body style="font:16px system-ui;padding:48px">${message}</body></html>`,
      );
    };
    let url, info, code;
    try {
      if (
        !["GET", "OPTIONS"].includes(req.method) ||
        req.headers.host !== new URL(flow.callbackOrigin).host ||
        req.url.length > 32768
      )
        throw new Error();
      url = new URL(req.url, flow.callbackOrigin);
      const markers = [
        "authCodeInfo",
        "userInfo",
        "token",
        "refreshToken",
        "error",
      ];
      if (
        !markers.some((key) => url.searchParams.has(key)) &&
        flow.expiresAt > Date.now()
      ) {
        res.writeHead(200, {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Allow-Private-Network": "true",
        });
        res.end("ok");
        return;
      }
      if (
        url.pathname !== "/authorize" ||
        url.searchParams.get("loginTraceID") !== flow.state ||
        flow.expiresAt <= Date.now() ||
        flow.processing ||
        flow.result
      )
        throw new Error();
      const host = url.searchParams.get("host");
      if (host && new URL(host).origin !== flow.definition.accountOrigin)
        throw new Error();
      info = JSON.parse(url.searchParams.get("userInfo") || "{}");
      code = JSON.parse(url.searchParams.get("authCodeInfo") || "{}").AuthCode;
      if (
        typeof code !== "string" ||
        !code ||
        code.length > 10000 ||
        !text(info.UserID)
      )
        throw new Error();
    } catch {
      send(400, "授权回调无效，请返回应用重试。");
      return;
    }
    flow.processing = true;
    try {
      const data = await this.json(
        `${flow.definition.accountOrigin}/trae/api/v3/oauth/ExchangeToken`,
        {
          method: "POST",
          signal: AbortSignal.any([
            flow.abort.signal,
            AbortSignal.timeout(15000),
          ]),
          headers: this.traeHeaders(flow.context),
          body: JSON.stringify({
            ClientID: flow.definition.authClientId,
            AuthCode: code,
            CodeVerifier: flow.verifier,
            DeviceInfo: this.deviceInfo(flow.context),
            IDEVersion: flow.context.appVersion,
          }),
        },
      );
      this.require(flow.id, flow.provider);
      const result = traeToken(data, info);
      if (!result.refreshToken)
        throw new Error("授权缺少刷新凭据，请重新授权。");
      flow.result = result;
      send(200, "账号授权已完成，请返回 WorkBuddy Switch。");
    } catch (error) {
      flow.error = error;
      send(400, "授权未完成，请返回应用查看原因。");
    } finally {
      flow.processing = false;
      flow.server.close();
    }
  }
  traeHeaders(context) {
    return {
      "x-cloudide-token": "",
      "x-device-id": context.deviceId,
      "x-app-id": "6eefa01c-1036-4c7e-9ca5-d891f63bfcd8",
      "x-platform-code": "IDE_PC",
    };
  }
  async poll(provider, id) {
    const flow = this.require(id, provider);
    if (flow.error) throw flow.error;
    if (flow.definition.product === "trae") return flow.result;
    if (flow.polling) return null;
    flow.polling = true;
    try {
      const url = new URL(
        "/api/v1/deviceToken/poll",
        flow.definition.accountOrigin,
      );
      for (const [key, value] of Object.entries({
        nonce: flow.nonce,
        verifier: flow.verifier,
        challenge_method: "S256",
      }))
        url.searchParams.set(key, value);
      const data = await this.json(url.toString(), {
        pending: true,
        signal: AbortSignal.any([
          flow.abort.signal,
          AbortSignal.timeout(15000),
        ]),
      });
      if (data === null) return null;
      const credential = qoderToken(data),
        user = await this.json(
          `${flow.definition.accountOrigin}/api/v1/userinfo`,
          {
            headers: { Authorization: `Bearer ${credential.token}` },
            signal: AbortSignal.any([
              flow.abort.signal,
              AbortSignal.timeout(15000),
            ]),
          },
        );
      const result = identity(
        user?.id,
        user?.name,
        credential.token,
        credential.refreshToken,
        credential.expiresAt,
        user,
      );
      this.require(id, provider);
      flow.result = result;
      return result;
    } finally {
      flow.polling = false;
    }
  }
  async refresh(provider, account) {
    const definition = editorDefinition(provider);
    if (!account.refreshToken)
      throw new Error("没有可用的刷新凭据，请重新授权。");
    if (definition.product === "qoder") {
      const kind = account.refreshToken.startsWith("drt-")
        ? "deviceToken"
        : account.refreshToken.startsWith("jrt-")
          ? "jobToken"
          : null;
      if (!kind) throw new Error("刷新凭据格式已变化，请重新授权。");
      const data = await this.json(
        `${definition.accountOrigin}/api/v1/${kind}/refresh`,
        {
          method: "POST",
          body: JSON.stringify({ refresh_token: account.refreshToken }),
        },
      );
      const credential = qoderToken(data, account);
      const user = await this.json(
        `${definition.accountOrigin}/api/v1/userinfo`,
        { headers: { Authorization: `Bearer ${credential.token}` } },
      );
      if (text(user?.id) !== account.uid)
        throw new Error("刷新授权的账号身份不一致，已停止保存。");
      return identity(
        account.uid,
        user.name || account.nickname,
        credential.token,
        credential.refreshToken,
        credential.expiresAt,
        user,
      );
    }
    const context = await this.context(provider, { privateKey: true });
    if (!context.privateKey)
      throw new Error("设备签名不可用，请在本机重新授权。");
    const requestPath = "/trae/api/v3/oauth/ExchangeToken",
      timestamp = Math.floor(Date.now() / 1000),
      nonce = randomBytes(16).toString("hex");
    let signature;
    try {
      signature = sign(
        "sha256",
        Buffer.from(
          `POST\n${requestPath}\n${definition.authClientId}\n${account.refreshToken}\n${timestamp}\n${nonce}`,
        ),
        { key: context.privateKey, dsaEncoding: "ieee-p1363" },
      ).toString("base64");
    } catch {
      throw new Error("设备签名不可用，请在本机重新授权。");
    }
    const data = await this.json(`${definition.accountOrigin}${requestPath}`, {
      method: "POST",
      headers: this.traeHeaders(context),
      body: JSON.stringify({
        ClientID: definition.authClientId,
        ClientSecret: "",
        RefreshToken: account.refreshToken,
        DeviceInfo: this.deviceInfo(context),
        IDEVersion: context.appVersion,
        DeviceProof: {
          Signature: signature,
          Timestamp: timestamp,
          Nonce: nonce,
        },
      }),
    });
    return traeToken(data, null, account);
  }
}
