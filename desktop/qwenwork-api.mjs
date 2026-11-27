import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { atomicWrite, readBounded } from "./files.mjs";
import { ApiError } from "./api-upstream.mjs";

const defaultPort = 4021;
const officialOrigin = "https://openapi.qwenwork.cn";
const sessionPath =
  /^\/session\/sessions\/[a-zA-Z0-9_-]{1,256}(?:\/(events(?:\/stream)?|prompt))?$/;
const validPort = (port) =>
  Number.isInteger(port) && port >= 1024 && port <= 65535;
const validMode = (mode) => mode === "compatible" || mode === "official";
const validKey = (value) =>
  typeof value === "string" && /^[\x21-\x7e]{1,8192}$/.test(value);

function checkRoute(mode, method, pathname, params) {
  let allowed = false;
  let queryKeys = [];
  if (mode === "compatible") {
    allowed =
      (method === "GET" && pathname === "/models") ||
      (method === "POST" && pathname === "/chat/completions");
  } else {
    const session = sessionPath.exec(pathname);
    if (session) {
      const action = session[1];
      allowed = method === (action === "prompt" ? "POST" : "GET");
      queryKeys = ["session_type"];
      if (action === "events") queryKeys.push("cursor", "limit");
      if (action === "events/stream")
        queryKeys.push("cursor", "include_status");
    } else {
      allowed =
        (method === "GET" && pathname === "/session/session-modes") ||
        (method === "POST" && pathname === "/session/sessions");
    }
  }
  if (!allowed)
    throw new ApiError(404, "not_found", "当前千问办公上游不提供此接口。");
  for (const [key, value] of params) {
    if (
      !queryKeys.includes(key) ||
      params.getAll(key).length !== 1 ||
      (key === "session_type" && value !== "cloud")
    )
      throw new ApiError(400, "invalid_query", "千问办公接口查询参数无效。");
  }
}

export class QwenWorkForwarder {
  connection = null;
  error = "";

  constructor(directory, vault, request) {
    this.file = path.join(directory, "qwenwork-api.json");
    this.vault = vault;
    this.request = request;
  }
  async init() {
    try {
      const value = JSON.parse(await readBounded(this.file, 64 * 1024));
      if (
        value.version !== 1 ||
        !validMode(value.mode) ||
        !validPort(value.port) ||
        typeof value.encrypted !== "string" ||
        !value.encrypted.length
      )
        throw new Error("invalid configuration");
      this.connection = value;
    } catch (error) {
      if (error.code !== "ENOENT")
        this.error = "千问办公上游配置无法读取，请重新连接。";
    }
  }
  status() {
    return {
      configured: !!this.connection,
      mode: this.connection?.mode ?? "compatible",
      port: this.connection?.port ?? defaultPort,
      error: this.error,
    };
  }
  async save(value, listenerPort) {
    if (value === null) {
      await fs.rm(this.file, { force: true });
      this.connection = null;
    } else {
      if (!value || !validMode(value.mode) || !validKey(value.key))
        throw new Error("请选择千问办公上游，并输入有效的访问密钥。");
      const port = value.mode === "compatible" ? value.port : defaultPort;
      if (
        !validPort(port) ||
        (value.mode === "compatible" && port === listenerPort)
      )
        throw new Error("上游端口须为 1024–65535，并与本机 API 监听端口不同。");
      if (!this.vault.available())
        throw new Error("请先解锁系统凭据存储，再保存上游密钥。");
      const encrypted = this.vault
        .encrypt(
          JSON.stringify({
            mode: value.mode,
            port,
            key: value.key,
          }),
        )
        .toString("base64");
      const next = { version: 1, mode: value.mode, port, encrypted };
      await atomicWrite(this.file, JSON.stringify(next));
      this.connection = next;
    }
    this.error = "";
  }
  checkListenerPort(port) {
    if (this.connection?.mode === "compatible" && this.connection.port === port)
      throw new Error(
        "本机 API 监听端口与千问办公上游端口相同，请更换其中一个端口。",
      );
  }
  async forward(req, res, url, readBody, signal) {
    const connection = this.connection;
    if (!connection)
      throw new ApiError(
        503,
        "qwenwork_unconfigured",
        "请先在千问办公的本机 API 页面连接上游。",
      );
    const pathname = url.pathname.slice("/qwenwork/v1".length);
    checkRoute(connection.mode, req.method, pathname, url.searchParams);
    const body = req.method === "POST" ? await readBody(req) : undefined;
    if (
      req.method === "POST" &&
      (!body || typeof body !== "object" || Array.isArray(body))
    )
      throw new ApiError(400, "invalid_request", "请求体须为 JSON 对象。");
    if (
      connection.mode === "official" &&
      body &&
      ("device_id" in body ||
        ("session_type" in body && body.session_type !== "cloud"))
    )
      throw new ApiError(
        400,
        "invalid_request",
        "千问办公开放平台转发仅支持云端会话。",
      );
    const origin =
      connection.mode === "official"
        ? officialOrigin
        : `http://127.0.0.1:${connection.port}`;
    let key;
    try {
      const saved = JSON.parse(
        this.vault.decrypt(Buffer.from(connection.encrypted, "base64")),
      );
      if (
        saved.mode !== connection.mode ||
        saved.port !== connection.port ||
        !validKey(saved.key)
      )
        throw new Error("invalid connection");
      key = saved.key;
    } catch {
      throw new ApiError(
        503,
        "qwenwork_key_unavailable",
        "请解锁系统凭据存储或重新连接千问办公上游。",
      );
    }
    const headers = {
      Authorization: "Bearer " + key,
      Accept: "application/json, text/event-stream",
      ...(body && { "Content-Type": "application/json" }),
    };
    if (
      connection.mode === "official" &&
      pathname.endsWith("/events/stream") &&
      req.headers["last-event-id"]
    ) {
      const cursor = req.headers["last-event-id"];
      if (typeof cursor !== "string" || !/^\d{1,20}$/.test(cursor))
        throw new ApiError(400, "invalid_cursor", "云端事件游标无效。");
      headers["Last-Event-ID"] = cursor;
    }
    let upstream;
    try {
      upstream = await this.request(origin + "/v1" + pathname + url.search, {
        method: req.method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        credentials: "omit",
        redirect: "manual",
        signal,
      });
    } catch {
      signal.throwIfAborted();
      throw new ApiError(
        502,
        "qwenwork_unreachable",
        connection.mode === "compatible"
          ? "无法连接本机 qwenwork2api，请确认上游已启动且端口正确。"
          : "无法连接千问办公开放平台。",
      );
    }
    const type = upstream.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    const nativeError = connection.mode === "official" && upstream.status >= 400 && type === "application/json";
    if (!upstream.ok && !nativeError) {
      await upstream.body?.cancel();
      const code = upstream.status;
      const retry = upstream.headers.get("retry-after");
      const message =
        code === 401
          ? "千问办公上游拒绝了访问密钥，请更新授权。"
          : code === 403
            ? "当前授权没有此千问办公接口或模型的使用权限。"
            : `千问办公上游返回 HTTP ${code}。`;
      throw new ApiError(
        code >= 400 && code <= 599 ? code : 502,
        "qwenwork_upstream",
        message,
        retry && /^\d{1,8}$/.test(retry) ? Number(retry) : 0,
      );
    }
    if (
      !upstream.body ||
      !["application/json", "text/event-stream"].includes(type)
    ) {
      await upstream.body?.cancel();
      throw new ApiError(
        502,
        "qwenwork_protocol",
        "千问办公上游响应格式无效。",
      );
    }
    if (connection.mode === "official") {
      for (const header of ["x-request-id", "x-trace-id"]) {
        const value = upstream.headers.get(header);
        if (value && /^[a-f0-9]{32}$/.test(value)) res.setHeader(header, value);
      }
      const retry = upstream.headers.get("retry-after");
      if (retry && /^\d{1,8}$/.test(retry)) res.setHeader("Retry-After", retry);
    }
    res.writeHead(upstream.status, {
      "Content-Type": type + "; charset=utf-8",
    });
    res.flushHeaders();
    await pipeline(Readable.fromWeb(upstream.body), res, { signal });
  }
}
