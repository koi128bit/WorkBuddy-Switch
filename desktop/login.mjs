import { randomUUID } from "node:crypto";
import { parseAuth } from "./auth.mjs";

const origin = "https://www.codebuddy.cn";
export function officialLoginURL(url) {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    !["www.codebuddy.cn", "www.workbuddy.cn"].includes(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.port
  )
    throw new Error("登录服务返回了无法信任的授权地址。");
  return parsed.toString();
}
export class Login {
  constructor(request) {
    this.request = request;
  }
  async json(url, options = {}) {
    let response;
    try {
      response = await this.request(url, {
        ...options,
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: {
          "Content-Type": "application/json",
          "X-Client-Platform": "web",
          ...(options.headers || {}),
        },
      });
    } catch {
      throw new Error("无法连接网页登录服务，请检查网络后重试。");
    }
    if (!response.ok)
      throw new Error(`网页登录服务暂不可用（HTTP ${response.status}）。`);
    try {
      return await response.json();
    } catch {
      throw new Error("网页登录服务返回了未知数据。");
    }
  }
  async start() {
    const response = await this.json(
      `${origin}/v2/plugin/auth/state?platform=workbuddy`,
      { method: "POST", body: "{}" },
    );
    const state = response.data?.state;
    if (typeof state !== "string" || !state || state.length > 500)
      throw new Error("登录服务未返回有效授权请求。");
    const url = officialLoginURL(
      response.data.authUrl ||
        response.data.auth_url ||
        response.data.url ||
        `${origin}/login?state=${encodeURIComponent(state)}`,
    );
    this.ticket = {
      id: randomUUID(),
      state,
      url,
      expiresAt: Date.now() + 300000,
    };
    return { id: this.ticket.id, expiresAt: this.ticket.expiresAt };
  }
  require(id) {
    if (
      !this.ticket ||
      this.ticket.id !== id ||
      this.ticket.expiresAt <= Date.now()
    )
      throw new Error("网页登录请求已过期，请重新开始。");
    return this.ticket;
  }
  cancel(id) {
    if (this.ticket?.id === id) this.ticket = null;
  }
  async poll(id) {
    const ticket = this.require(id);
    const response = await this.json(
      `${origin}/v2/plugin/auth/token?state=${encodeURIComponent(ticket.state)}`,
    );
    const data = response.data;
    const token = data?.accessToken ?? data?.access_token;
    if (typeof token !== "string" || !token) return null;
    const domain = data.domain || "www.codebuddy.cn";
    if (
      ![
        "codebuddy.cn",
        "www.codebuddy.cn",
        "workbuddy.cn",
        "www.workbuddy.cn",
      ].includes(domain)
    )
      throw new Error("登录凭据的服务域名不匹配，已停止保存。");
    const responseProfile = await this.json(
      `${origin}/v2/plugin/login/account?state=${encodeURIComponent(ticket.state)}`,
      { headers: { Authorization: `Bearer ${token}`, "X-Domain": domain } },
    );
    if (!responseProfile.data?.uid)
      throw new Error("网页登录未返回有效账号信息。");
    const document = parseAuth(
      JSON.stringify({
        account: responseProfile.data,
        auth: {
          ...data,
          accessToken: token,
          refreshToken: data.refreshToken ?? data.refresh_token,
          domain,
          expiresAt:
            data.expiresAt ??
            (data.expiresIn
              ? Date.now() + Number(data.expiresIn) * 1000
              : null),
        },
        allAccounts: [responseProfile.data],
      }),
    );
    this.require(id);
    return document;
  }
}
