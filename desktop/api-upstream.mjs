import { randomUUID } from "node:crypto";
import { apiOrigin } from "./quota.mjs";

export class ApiError extends Error {
  constructor(status, code, message, retryAfter = 0) {
    super(message);
    Object.assign(this, { status, code, retryAfter });
    if (status === 401) this.kind = "auth";
  }
}
const fail = (message) => {
  throw new ApiError(400, "invalid_request", message);
};
const record = (value) =>
  value && typeof value === "object" && !Array.isArray(value);
const identifier = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_.-]{1,160}$/.test(value);
const name = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const number = (value) =>
  Number.isSafeInteger(value) && value >= 0 ? value : null;
const fields = new Set([
  "model",
  "messages",
  "stream",
  "stream_options",
  "max_tokens",
  "max_completion_tokens",
  "temperature",
  "top_p",
  "tools",
  "tool_choice",
  "parallel_tool_calls",
  "response_format",
  "frequency_penalty",
  "presence_penalty",
  "stop",
  "seed",
  "reasoning_effort",
  "thinking",
  "conversation_id",
  "user",
  "n",
  "metadata",
  "store",
  "service_tier",
  "prompt_cache_key",
  "promptCacheKey",
  "prompt_cache_retention",
  "safety_identifier",
  "logprobs",
  "top_logprobs",
]);
export function prepareApiRequest(raw, limit) {
  if (!record(raw)) fail("请求须为 JSON 对象。");
  if (Object.keys(raw).some((key) => !fields.has(key)))
    fail("请求含不支持的参数；请使用对应接口的请求格式。");
  if (raw.logprobs || raw.top_logprobs)
    fail("上游暂不提供 logprobs，请关闭此选项。");
  const global =
    typeof raw.model === "string" && raw.model.startsWith("global:");
  const model = global ? raw.model.slice(7) : raw.model;
  if (!identifier(model)) fail("模型标识无效，国际版请使用 global: 前缀。");
  if (
    !Array.isArray(raw.messages) ||
    !raw.messages.length ||
    raw.messages.length > 2000
  )
    fail("messages 应包含 1–2000 条消息。");
  const messages = raw.messages.map((message) => {
    if (
      !record(message) ||
      !["system", "developer", "user", "assistant", "tool"].includes(
        message.role,
      )
    )
      fail("消息角色无效。");
    const value = {
      role: message.role === "developer" ? "system" : message.role,
    };
    if (typeof message.content === "string" || message.content === null)
      value.content = message.content;
    else if (Array.isArray(message.content))
      value.content = message.content.map((part) => {
        if (part?.type === "text" && typeof part.text === "string")
          return { type: "text", text: part.text };
        if (part?.type === "image_url") {
          const image =
            typeof part.image_url === "string"
              ? { url: part.image_url }
              : part.image_url;
          if (!record(image) || typeof image.url !== "string")
            fail("图片参数无效。");
          let valid =
            /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=\r\n]+$/.test(
              image.url,
            );
          try {
            const url = new URL(image.url);
            valid ||=
              url.protocol === "https:" && !url.username && !url.password;
          } catch {}
          if (!valid) fail("图片仅支持 HTTPS 链接或图像 Base64 数据。");
          return {
            type: "image_url",
            image_url: {
              url: image.url,
              ...(["auto", "low", "high"].includes(image.detail)
                ? { detail: image.detail }
                : {}),
            },
          };
        }
        fail("消息包含不支持的内容类型。");
      });
    else if (message.role === "assistant" && Array.isArray(message.tool_calls))
      value.content = null;
    else fail("消息内容无效。");
    if (message.tool_calls !== undefined) {
      if (
        message.role !== "assistant" ||
        !Array.isArray(message.tool_calls) ||
        message.tool_calls.length > 32
      )
        fail("工具调用记录无效。");
      value.tool_calls = message.tool_calls.map((call) => {
        if (
          typeof call?.id !== "string" ||
          call.id.length > 200 ||
          call.type !== "function" ||
          !name(call.function?.name) ||
          typeof call.function.arguments !== "string"
        )
          fail("工具调用记录无效。");
        return {
          id: call.id,
          type: "function",
          function: {
            name: call.function.name,
            arguments: call.function.arguments,
          },
        };
      });
    }
    if (message.role === "tool") {
      if (
        typeof message.tool_call_id !== "string" ||
        message.tool_call_id.length > 200
      )
        fail("工具结果缺少 tool_call_id。");
      value.tool_call_id = message.tool_call_id;
    }
    if (message.reasoning_content !== undefined) {
      if (
        message.role !== "assistant" ||
        typeof message.reasoning_content !== "string"
      )
        fail("reasoning_content 无效。");
      value.reasoning_content = message.reasoning_content;
    }
    return value;
  });
  if (global && !messages.some((message) => message.role === "system"))
    messages.unshift({
      role: "system",
      content: "You are a helpful assistant.",
    });
  if (raw.stream !== undefined && typeof raw.stream !== "boolean")
    fail("stream 须为布尔值。");
  if (raw.n !== undefined && raw.n !== 1) fail("目前仅支持 n=1。");
  if (
    raw.conversation_id !== undefined &&
    (typeof raw.conversation_id !== "string" ||
      raw.conversation_id.length > 200 ||
      /[\x00-\x1f]/.test(raw.conversation_id))
  )
    fail("conversation_id 无效。");
  const max = raw.max_tokens ?? raw.max_completion_tokens ?? limit;
  if (!Number.isSafeInteger(max) || max < 1) fail("max_tokens 应为正整数。");
  const payload = {
    model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: Math.min(max, limit),
    agent: "cli",
  };
  for (const [key, low, high] of [
    ["temperature", 0, 2],
    ["top_p", 0, 1],
    ["frequency_penalty", -2, 2],
    ["presence_penalty", -2, 2],
  ])
    if (raw[key] !== undefined) {
      if (!finite(raw[key]) || raw[key] < low || raw[key] > high)
        fail(key + " 不在支持范围内。");
      payload[key] = raw[key];
    }
  if (raw.seed !== undefined) {
    if (!Number.isSafeInteger(raw.seed)) fail("seed 无效。");
    payload.seed = raw.seed;
  }
  if (raw.user !== undefined) {
    if (typeof raw.user !== "string" || raw.user.length > 256)
      fail("user 无效。");
    payload.user = raw.user;
  }
  if (raw.stop !== undefined) {
    if (
      !(
        typeof raw.stop === "string" ||
        (Array.isArray(raw.stop) &&
          raw.stop.length <= 4 &&
          raw.stop.every(
            (value) => typeof value === "string" && value.length <= 1000,
          ))
      )
    )
      fail("stop 无效。");
    payload.stop = raw.stop;
  }
  if (raw.tools !== undefined) {
    if (!Array.isArray(raw.tools) || raw.tools.length > 128)
      fail("tools 最多包含 128 个函数。");
    payload.tools = raw.tools.map((tool) => {
      if (
        tool?.type !== "function" ||
        !name(tool.function?.name) ||
        !record(tool.function.parameters ?? {})
      )
        fail("工具定义无效。");
      return {
        type: "function",
        function: {
          name: tool.function.name,
          parameters: tool.function.parameters ?? {},
          ...(typeof tool.function.description === "string"
            ? { description: tool.function.description }
            : {}),
          ...(typeof tool.function.strict === "boolean"
            ? { strict: tool.function.strict }
            : {}),
        },
      };
    });
  }
  if (raw.tool_choice !== undefined) {
    if (
      !["auto", "none", "required"].includes(raw.tool_choice) &&
      !(
        raw.tool_choice?.type === "function" &&
        name(raw.tool_choice.function?.name)
      )
    )
      fail("tool_choice 无效。");
    payload.tool_choice = raw.tool_choice;
  }
  if (raw.parallel_tool_calls !== undefined) {
    if (typeof raw.parallel_tool_calls !== "boolean")
      fail("parallel_tool_calls 无效。");
    payload.parallel_tool_calls = raw.parallel_tool_calls;
  }
  if (raw.response_format !== undefined) {
    if (
      !record(raw.response_format) ||
      !["text", "json_object", "json_schema"].includes(raw.response_format.type)
    )
      fail("response_format 无效。");
    payload.response_format = raw.response_format;
  }
  if (raw.reasoning_effort !== undefined) {
    if (
      ![
        "none",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
        "ultra",
      ].includes(raw.reasoning_effort)
    )
      fail("reasoning_effort 无效。");
    payload.reasoning_effort = raw.reasoning_effort;
  }
  if (raw.thinking !== undefined) {
    if (
      !record(raw.thinking) ||
      !["enabled", "disabled"].includes(raw.thinking.type)
    )
      fail("thinking 无效。");
    payload.thinking = raw.thinking;
  }
  return {
    provider: global ? "workbuddy-global" : "workbuddy",
    model: raw.model,
    stream: raw.stream === true,
    includeUsage: raw.stream_options?.include_usage === true,
    session: raw.conversation_id || null,
    payload,
  };
}
function endpoint(document) {
  const origin = apiOrigin(document);
  if (!document.token)
    throw new ApiError(
      401,
      "credential_required",
      "请先在应用内完成官方网页登录授权。",
    );
  return ["https://www.workbuddy.cn", "https://www.workbuddy.ai"].includes(
    origin,
  )
    ? origin
    : "https://copilot.tencent.com";
}
function headers(document, conversationId) {
  return {
    Authorization: "Bearer " + document.token,
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "User-Agent": "WorkBuddy-Switch/1.7 WorkBuddy/5.8.3",
    "X-User-Id": document.id,
    "X-Domain": new URL(apiOrigin(document)).hostname,
    "X-Product": "SaaS",
    "X-Agent-Intent": "craft",
    "X-Agent-Type": "main",
    "X-Conversation-ID": conversationId,
    "X-Request-ID": randomUUID(),
  };
}
async function boundedText(response, limit) {
  let bytes = 0,
    text = "";
  const decoder = new TextDecoder();
  if (!response.body) return "";
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > limit)
      throw new ApiError(
        502,
        "upstream_response_too_large",
        "上游响应超过安全大小限制。",
      );
    text += decoder.decode(chunk, { stream: true });
  }
  return text + decoder.decode();
}
function businessError(status, body, retryHeader) {
  let code;
  try {
    const value = JSON.parse(body);
    code = String(value.code ?? value.error?.code ?? "");
  } catch {}
  const retry = Math.min(3600, Math.max(1, Number(retryHeader) || 60));
  if (code === "11128" || status === 403)
    return new ApiError(
      403,
      "upstream_access_denied",
      "上游拒绝 API 通道或账号权限，请在官方客户端核对。",
    );
  if (status === 401 || code === "12153")
    return new ApiError(
      401,
      "upstream_auth_expired",
      "官方授权已失效，请在应用内重新登录。",
    );
  if (
    status === 402 ||
    ["14001", "14002", "14012", "14013", "14014", "14018"].includes(code)
  )
    return new ApiError(
      402,
      "insufficient_credits",
      "官方账号积分不足。",
      retry,
    );
  if (status === 429 || code === "6004")
    return new ApiError(
      429,
      "upstream_rate_limit",
      "上游模型使用量或请求频率已达到限制。",
      retry,
    );
  if (status === 404 || ["11102", "11158"].includes(code))
    return new ApiError(
      404,
      "model_not_available",
      "该账号暂不能使用所选模型。",
      60,
    );
  return new ApiError(
    status >= 400 && status < 500 ? 400 : 502,
    "upstream_error",
    "官方服务未完成本次请求，请检查模型、输入和服务状态。",
  );
}
export async function openApiChat(
  document,
  payload,
  conversationId,
  request,
  signal,
) {
  let response;
  try {
    response = await request(endpoint(document) + "/v2/chat/completions", {
      method: "POST",
      redirect: "error",
      signal,
      headers: headers(document, conversationId),
      body: JSON.stringify(payload),
    });
  } catch {
    throw new ApiError(
      502,
      "upstream_transport_error",
      "对话连接中断，结果和消耗尚未确认，不会自动重发。",
    );
  }
  if (!response.ok)
    throw businessError(
      response.status,
      await boundedText(response, 1024 * 1024),
      response.headers.get("retry-after"),
    );
  return response;
}
export async function fetchApiModels(document, request, signal) {
  const origin = endpoint(document),
    options = {
      method: "GET",
      redirect: "error",
      signal,
      headers: {
        ...headers(document, randomUUID()),
        Accept: "application/json",
      },
    };
  let failure;
  for (const route of ["/v3/config", "/console/enterprises/personal/models"]) {
    try {
      const response = await request(origin + route, options),
        raw = await boundedText(response, 2 * 1024 * 1024);
      if (!response.ok)
        throw businessError(
          response.status,
          raw,
          response.headers.get("retry-after"),
        );
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new ApiError(502, "invalid_model_list", "模型目录格式无法识别。");
      }
      if (data.code !== undefined && ![0, 200, "0", "200"].includes(data.code))
        throw businessError(502, raw);
      const catalog = data.data?.models;
      if (!Array.isArray(catalog))
        throw new ApiError(502, "invalid_model_list", "模型目录格式无法识别。");
      const allowed =
        data.data?.agents?.find((agent) => agent.name === "cli")?.models ??
        data.data?.availableModels;
      const seen = new Set();
      const models = catalog
        .filter((model) => {
          const eligible =
            identifier(model?.id) &&
            !model.disabled &&
            !seen.has(model.id) &&
            (!Array.isArray(allowed) ||
              allowed.some(
                (value) =>
                  (typeof value === "string" ? value : value?.id) === model.id,
              )) &&
            !/^(nes-|completion-|codewise-)/.test(model.id) &&
            (!Number.isFinite(model.maxOutputTokens) ||
              model.maxOutputTokens > 256) &&
            !model.tags?.some((tag) =>
              [
                "text-to-image",
                "text-to-video",
                "image-to-video",
                "image-generation",
                "video-generation",
              ].includes(tag),
            ) &&
            !/(?:^|[-_])(?:video|image)(?:$|[-_])/.test(model.id);
          if (eligible) seen.add(model.id);
          return eligible;
        })
        .map((model) => {
          return {
            id: model.id,
            object: "model",
            created: 0,
            owned_by: "workbuddy",
            ...(typeof model.name === "string"
              ? { name: model.name.slice(0, 160) }
              : {}),
            ...(number(model.maxInputTokens) !== null
              ? { context_window: model.maxInputTokens }
              : {}),
            ...(number(model.maxOutputTokens) !== null
              ? { max_output_tokens: model.maxOutputTokens }
              : {}),
            ...(typeof model.supportsToolCall === "boolean"
              ? { supports_tool_calls: model.supportsToolCall }
              : {}),
            ...(typeof model.supportsImages === "boolean"
              ? { supports_images: model.supportsImages }
              : {}),
          };
        });
      if (!models.length)
        throw new ApiError(502, "empty_model_list", "官方未返回可用对话模型。");
      return models;
    } catch (error) {
      failure = error;
      if ([401, 403, 429].includes(error.status)) throw error;
    }
  }
  throw failure instanceof ApiError
    ? failure
    : new ApiError(
        502,
        "model_discovery_failed",
        "模型目录查询失败，请检查网络及官方授权。",
      );
}
export async function* apiChatFrames(response, model, requestId) {
  const created = Math.floor(Date.now() / 1000);
  let finished = false,
    output = false,
    bytes = 0;
  const normalize = (value) => {
    if (
      value.error ||
      (value.code !== undefined && ![0, 200, "0", "200"].includes(value.code))
    )
      throw businessError(
        502,
        JSON.stringify({ code: value.code, error: value.error }),
      );
    if (!Array.isArray(value.choices)) {
      if (value.usage)
        return {
          id: requestId,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [],
          usage: cleanUsage(value.usage),
        };
      return null;
    }
    const choices = value.choices.slice(0, 1).map((choice) => {
      const source = choice.delta ?? choice.message ?? {},
        delta = {};
      if (source.role === "assistant") delta.role = "assistant";
      for (const field of ["content", "reasoning_content"])
        if (typeof source[field] === "string") {
          delta[field] = source[field];
          if (source[field].length) output = true;
        }
      if (Array.isArray(source.tool_calls)) {
        delta.tool_calls = source.tool_calls.slice(0, 32).map((call, index) => {
          const safe = {
            index: Number.isInteger(call.index) ? call.index : index,
          };
          if (typeof call.id === "string") safe.id = call.id.slice(0, 200);
          if (call.type === "function") safe.type = "function";
          if (record(call.function)) {
            safe.function = {};
            for (const field of ["name", "arguments"])
              if (typeof call.function[field] === "string")
                safe.function[field] = call.function[field];
            output = true;
          }
          return safe;
        });
      }
      const reason = choice.finish_reason || null;
      if (reason !== null) {
        if (
          !["stop", "length", "tool_calls", "content_filter"].includes(reason)
        )
          throw new ApiError(
            502,
            "invalid_finish_reason",
            "上游对话结束状态无法识别。",
          );
        finished = true;
      }
      return { index: 0, delta, finish_reason: reason };
    });
    return {
      id: typeof value.id === "string" ? value.id.slice(0, 200) : requestId,
      object: "chat.completion.chunk",
      created,
      model,
      choices,
      ...(value.usage ? { usage: cleanUsage(value.usage) } : {}),
    };
  };
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    let value;
    try {
      value = JSON.parse(await boundedText(response, 32 * 1024 * 1024));
    } catch (error) {
      throw error instanceof ApiError
        ? error
        : new ApiError(
            502,
            "invalid_upstream_response",
            "上游对话返回格式无法识别。",
          );
    }
    const frame = normalize(value);
    if (frame) yield frame;
  } else {
    const reader = response.body?.getReader();
    if (!reader)
      throw new ApiError(502, "empty_upstream_stream", "上游未返回对话流。");
    let buffer = "",
      data = [],
      done = false;
    const decoder = new TextDecoder();
    try {
      while (!done) {
        const chunk = await reader.read();
        if (chunk.done) {
          buffer += decoder.decode();
          if (buffer) buffer += "\n\n";
          else break;
        } else {
          bytes += chunk.value.byteLength;
          if (bytes > 32 * 1024 * 1024)
            throw new ApiError(
              502,
              "upstream_response_too_large",
              "对话响应超过安全大小限制。",
            );
          buffer += decoder.decode(chunk.value, { stream: true });
        }
        if (buffer.length > 2 * 1024 * 1024 && !buffer.includes("\n"))
          throw new ApiError(
            502,
            "upstream_frame_too_large",
            "对话数据帧过大。",
          );
        let index;
        while ((index = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, index).replace(/\r$/, "");
          buffer = buffer.slice(index + 1);
          if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
          else if (line === "" && data.length) {
            const raw = data.join("\n");
            data = [];
            if (raw === "[DONE]") {
              done = true;
              break;
            }
            let value;
            try {
              value = JSON.parse(raw);
            } catch {
              throw new ApiError(
                502,
                "invalid_upstream_stream",
                "对话流中出现无法解析的数据，结果尚未确认。",
              );
            }
            const frame = normalize(value);
            if (frame) yield frame;
          }
        }
        if (chunk.done) break;
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  if (!finished || !output)
    throw new ApiError(
      502,
      "incomplete_upstream_stream",
      "未取得完整模型结果，消耗尚未确认，不会自动重试。",
    );
}
export function cleanUsage(raw) {
  const result = {};
  for (const key of ["prompt_tokens", "completion_tokens", "total_tokens"])
    if (number(raw?.[key]) !== null) result[key] = raw[key];
  for (const [key, field] of [
    ["prompt_tokens_details", "cached_tokens"],
    ["completion_tokens_details", "reasoning_tokens"],
  ])
    if (number(raw?.[key]?.[field]) !== null)
      result[key] = { [field]: raw[key][field] };
  return result;
}
export function aggregateApiFrames(frames, model, requestId) {
  let content = "",
    reasoning = "",
    finish = "stop",
    usage,
    id = requestId,
    created = Math.floor(Date.now() / 1000);
  const calls = new Map();
  for (const frame of frames) {
    id = frame.id;
    created = frame.created;
    if (frame.usage) usage = frame.usage;
    const choice = frame.choices[0];
    if (!choice) continue;
    if (choice.finish_reason) finish = choice.finish_reason;
    content += choice.delta.content ?? "";
    reasoning += choice.delta.reasoning_content ?? "";
    for (const fragment of choice.delta.tool_calls ?? []) {
      const call = calls.get(fragment.index) ?? {
        id: "",
        type: "function",
        function: { name: "", arguments: "" },
      };
      if (fragment.id) call.id = fragment.id;
      call.function.name += fragment.function?.name ?? "";
      call.function.arguments += fragment.function?.arguments ?? "";
      calls.set(fragment.index, call);
    }
  }
  return {
    id,
    object: "chat.completion",
    created,
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: content || null,
          ...(reasoning ? { reasoning_content: reasoning } : {}),
          ...(calls.size ? { tool_calls: [...calls.values()] } : {}),
        },
        finish_reason: finish,
      },
    ],
    ...(usage ? { usage } : {}),
  };
}
