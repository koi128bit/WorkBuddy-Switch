import { randomUUID } from "node:crypto";
import { ApiError, prepareApiRequest } from "./api-upstream.mjs";

const object = (v) => v && typeof v === "object" && !Array.isArray(v);
const invalid = (message) => {
  throw new ApiError(400, "invalid_request", message);
};
const unsupported = (message) => {
  throw new ApiError(400, "unsupported_parameter", message);
};
const list = (v, name) => {
  if (!Array.isArray(v) || v.length > 2000)
    invalid(name + " 必须是最多 2000 项的数组。");
  return v;
};
function textBlocks(value) {
  if (typeof value === "string") return value;
  return list(value, "文本内容")
    .map((part) => {
      if (part?.type !== "text" || typeof part.text !== "string")
        invalid("此位置仅支持文本内容。");
      return part.text;
    })
    .join("\n");
}
function image(part, protocol) {
  if (protocol === "responses")
    return {
      type: "image_url",
      image_url: {
        url: part.image_url,
        ...(part.detail ? { detail: part.detail } : {}),
      },
    };
  const source = part.source;
  if (source?.type === "url")
    return { type: "image_url", image_url: { url: source.url } };
  if (
    source?.type === "base64" &&
    typeof source.media_type === "string" &&
    typeof source.data === "string"
  )
    return {
      type: "image_url",
      image_url: {
        url: "data:" + source.media_type + ";base64," + source.data,
      },
    };
  invalid("图片来源格式无效。");
}
function responsesInput(raw) {
  if (raw.previous_response_id)
    unsupported(
      "本机 Responses 使用无状态模式，请发送完整 input 历史并设置 store:false。",
    );
  if (raw.background) unsupported("本机 API 不支持后台 Responses 请求。");
  const messages = [];
  if (raw.instructions !== undefined && raw.instructions !== null) {
    if (typeof raw.instructions !== "string")
      invalid("instructions 应为文本。");
    messages.push({ role: "system", content: raw.instructions });
  }
  const input =
    typeof raw.input === "string"
      ? [{ role: "user", content: raw.input }]
      : list(raw.input, "input");
  for (const item of input) {
    if (!object(item)) invalid("input 消息格式无效。");
    if (item.type === "function_call") {
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: item.call_id,
            type: "function",
            function: { name: item.name, arguments: item.arguments },
          },
        ],
      });
    } else if (item.type === "function_call_output") {
      const content =
        typeof item.output === "string"
          ? item.output
          : list(item.output, "output")
              .map((p) => {
                if (p?.type !== "input_text" || typeof p.text !== "string")
                  invalid("函数返回目前仅支持文本。");
                return p.text;
              })
              .join("\n");
      messages.push({ role: "tool", tool_call_id: item.call_id, content });
    } else if (item.type === "reasoning") {
      if (item.encrypted_content)
        unsupported(
          "本机 API 无法解密其他服务生成的 reasoning，请重新开始对话。",
        );
      const summary = list(item.summary ?? [], "reasoning.summary")
        .map((p) => {
          if (p?.type !== "summary_text" || typeof p.text !== "string")
            invalid("推理摘要格式无效。");
          return p.text;
        })
        .join("\n");
      if (summary)
        messages.push({
          role: "assistant",
          content: null,
          reasoning_content: summary,
        });
    } else {
      if (item.type && item.type !== "message")
        unsupported("input 包含不支持的托管工具或文件类型。");
      const content =
        typeof item.content === "string"
          ? item.content
          : list(item.content, "content").map((p) => {
              if (
                ["input_text", "output_text"].includes(p?.type) &&
                typeof p.text === "string"
              )
                return { type: "text", text: p.text };
              if (p?.type === "input_image") return image(p, "responses");
              unsupported("Responses 目前支持文本、图片及函数调用。");
            });
      messages.push({ role: item.role, content });
    }
  }
  const tools =
    raw.tools === undefined
      ? undefined
      : list(raw.tools, "tools").map((tool) => {
          if (tool?.type !== "function")
            unsupported(
              "请使用客户端本地函数工具；本机 API 不执行 web_search、shell 等服务端托管工具。",
            );
          return {
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
              strict: tool.strict,
            },
          };
        });
  const format = raw.text?.format;
  return {
    model: raw.model,
    messages,
    stream: raw.stream,
    max_tokens: raw.max_output_tokens,
    tools,
    tool_choice: object(raw.tool_choice)
      ? { type: "function", function: { name: raw.tool_choice.name } }
      : raw.tool_choice,
    parallel_tool_calls: raw.parallel_tool_calls,
    temperature: raw.temperature,
    top_p: raw.top_p,
    reasoning_effort: raw.reasoning?.effort,
    response_format:
      format?.type === "json_schema"
        ? {
            type: "json_schema",
            json_schema: {
              name: format.name,
              schema: format.schema,
              strict: format.strict,
              description: format.description,
            },
          }
        : format,
  };
}
function messagesInput(raw) {
  const messages = [];
  if (raw.system !== undefined)
    messages.push({ role: "system", content: textBlocks(raw.system) });
  for (const message of list(raw.messages, "messages")) {
    if (!["user", "assistant"].includes(message?.role))
      invalid("Messages 消息角色须为 user 或 assistant。");
    if (typeof message.content === "string") {
      messages.push({ role: message.role, content: message.content });
      continue;
    }
    let content = [],
      calls = [],
      reasoning = "";
    const flush = () => {
      if (content.length || calls.length || reasoning)
        messages.push({
          role: message.role,
          content: content.length ? content : null,
          ...(calls.length ? { tool_calls: calls } : {}),
          ...(reasoning ? { reasoning_content: reasoning } : {}),
        });
      content = [];
      calls = [];
      reasoning = "";
    };
    for (const part of list(message.content, "content")) {
      if (part?.type === "text" && typeof part.text === "string")
        content.push({ type: "text", text: part.text });
      else if (part?.type === "image") content.push(image(part, "messages"));
      else if (
        part?.type === "thinking" &&
        message.role === "assistant" &&
        typeof part.thinking === "string"
      )
        reasoning += part.thinking;
      else if (
        part?.type === "tool_use" &&
        message.role === "assistant" &&
        object(part.input)
      )
        calls.push({
          id: part.id,
          type: "function",
          function: { name: part.name, arguments: JSON.stringify(part.input) },
        });
      else if (part?.type === "tool_result" && message.role === "user") {
        flush();
        messages.push({
          role: "tool",
          tool_call_id: part.tool_use_id,
          content: textBlocks(part.content ?? ""),
        });
      } else unsupported("Messages 目前支持文本、图片和本地函数工具。");
    }
    flush();
  }
  const choice = raw.tool_choice;
  const format = raw.output_config?.format;
  return {
    model: raw.model,
    messages,
    stream: raw.stream,
    max_tokens: raw.max_tokens,
    temperature: raw.temperature,
    top_p: raw.top_p,
    stop: raw.stop_sequences,
    tools:
      raw.tools === undefined
        ? undefined
        : list(raw.tools, "tools").map((tool) => {
            if (!object(tool) || (tool.type && tool.type !== "custom"))
              unsupported("Messages 仅支持客户端函数工具。");
            return {
              type: "function",
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.input_schema,
              },
            };
          }),
    tool_choice:
      choice?.type === "tool"
        ? { type: "function", function: { name: choice.name } }
        : choice?.type === "any"
          ? "required"
          : choice?.type,
    parallel_tool_calls:
      choice?.disable_parallel_tool_use === undefined
        ? undefined
        : !choice.disable_parallel_tool_use,
    thinking:
      raw.thinking?.type === "adaptive" ? { type: "enabled" } : raw.thinking,
    reasoning_effort: raw.output_config?.effort,
    response_format:
      format?.type === "json_schema"
        ? {
            type: "json_schema",
            json_schema: { name: "response", schema: format.schema },
          }
        : undefined,
  };
}
export function prepareProtocolRequest(raw, protocol, limit) {
  if (!object(raw)) invalid("请求须为 JSON 对象。");
  const normalized =
    protocol === "responses"
      ? responsesInput(raw)
      : protocol === "messages"
        ? messagesInput(raw)
        : raw;
  return { ...prepareApiRequest(normalized, limit), protocol };
}

// Both adapters consume verified Chat frames. Tools run in the calling client;
// conversation content is never retained between requests or written to disk.
export class ProtocolStream {
  constructor(protocol, model) {
    this.protocol = protocol;
    this.model = model;
    this.id =
      (protocol === "responses" ? "resp_" : "msg_") +
      randomUUID().replaceAll("-", "");
    this.created = Math.floor(Date.now() / 1000);
    this.items = [];
    this.tools = new Map();
    this.started = false;
    this.sequence = 0;
    this.finishReason = "stop";
  }
  event(type, value = {}) {
    const event = {
      type,
      ...value,
      ...(this.protocol === "responses"
        ? { sequence_number: this.sequence++ }
        : {}),
    };
    return "event: " + type + "\ndata: " + JSON.stringify(event) + "\n\n";
  }
  result(status = "completed") {
    if (this.protocol === "messages")
      return {
        id: this.id,
        type: "message",
        role: "assistant",
        model: this.model,
        content: this.items.map((item) =>
          item.kind === "tool"
            ? {
                type: "tool_use",
                id: item.call_id,
                name: item.name,
                input: this.toolInput(item),
              }
            : { type: "text", text: item.text },
        ),
        stop_reason:
          status === "in_progress"
            ? null
            : this.finishReason === "tool_calls"
              ? "tool_use"
              : this.finishReason === "length"
                ? "max_tokens"
                : "end_turn",
        stop_sequence: null,
        usage: this.anthropicUsage(),
        usage_known: !!this.usage,
      };
    return {
      id: this.id,
      object: "response",
      created_at: this.created,
      model: this.model,
      status:
        status === "completed" && this.finishReason === "length"
          ? "incomplete"
          : status,
      error: null,
      incomplete_details:
        this.finishReason === "length" ? { reason: "max_output_tokens" } : null,
      output: this.items.map((item) => this.responseItem(item, status)),
      parallel_tool_calls: true,
      store: false,
      tools: [],
      tool_choice: "auto",
      usage: this.usage
        ? {
            input_tokens: this.usage.prompt_tokens ?? 0,
            input_tokens_details: {
              cached_tokens:
                this.usage.prompt_tokens_details?.cached_tokens ?? 0,
            },
            output_tokens: this.usage.completion_tokens ?? 0,
            output_tokens_details: {
              reasoning_tokens:
                this.usage.completion_tokens_details?.reasoning_tokens ?? 0,
            },
            total_tokens:
              this.usage.total_tokens ??
              (this.usage.prompt_tokens ?? 0) +
                (this.usage.completion_tokens ?? 0),
          }
        : null,
    };
  }
  toolInput(item) {
    try {
      const value = JSON.parse(item.arguments || "{}");
      if (object(value)) return value;
    } catch {}
    throw new ApiError(
      502,
      "invalid_tool_arguments",
      "上游工具参数不是有效的 JSON 对象，已停止本次工具调用。",
    );
  }
  anthropicUsage() {
    return {
      input_tokens: this.usage?.prompt_tokens ?? 0,
      output_tokens: this.usage?.completion_tokens ?? 0,
    };
  }
  responseItem(item, status) {
    const state = status === "in_progress" ? "in_progress" : "completed";
    return item.kind === "tool"
      ? {
          type: "function_call",
          id: item.id,
          call_id: item.call_id,
          name: item.name,
          arguments: item.arguments,
          status: state,
        }
      : {
          type: "message",
          id: item.id,
          role: "assistant",
          status: state,
          content: [
            {
              type: "output_text",
              text: item.text,
              annotations: [],
              logprobs: [],
            },
          ],
        };
  }
  startItem(item) {
    this.items.push(item);
    const index = this.items.length - 1;
    item.index = index;
    if (this.protocol === "responses") {
      const events = [
        this.event("response.output_item.added", {
          output_index: index,
          item: this.responseItem(item, "in_progress"),
        }),
      ];
      if (item.kind === "text")
        events.push(
          this.event("response.content_part.added", {
            item_id: item.id,
            output_index: index,
            content_index: 0,
            part: {
              type: "output_text",
              text: "",
              annotations: [],
              logprobs: [],
            },
          }),
        );
      return events;
    }
    return [
      this.event("content_block_start", {
        index,
        content_block:
          item.kind === "tool"
            ? { type: "tool_use", id: item.call_id, name: item.name, input: {} }
            : { type: "text", text: "" },
      }),
    ];
  }
  push(frame) {
    const events = [];
    if (frame.usage) this.usage = frame.usage;
    if (!this.started) {
      this.started = true;
      if (this.protocol === "responses")
        events.push(
          this.event("response.created", {
            response: this.result("in_progress"),
          }),
          this.event("response.in_progress", {
            response: this.result("in_progress"),
          }),
        );
      else
        events.push(
          this.event("message_start", { message: this.result("in_progress") }),
        );
    }
    const choice = frame.choices[0];
    if (!choice) return events;
    if (choice.finish_reason) this.finishReason = choice.finish_reason;
    const delta = choice.delta;
    if (delta.content) {
      if (!this.textItem) {
        this.textItem = {
          kind: "text",
          id: "msg_" + randomUUID().replaceAll("-", ""),
          text: "",
        };
        events.push(...this.startItem(this.textItem));
      }
      const item = this.textItem;
      item.text += delta.content;
      events.push(
        this.protocol === "responses"
          ? this.event("response.output_text.delta", {
              item_id: item.id,
              output_index: item.index,
              content_index: 0,
              delta: delta.content,
              logprobs: [],
            })
          : this.event("content_block_delta", {
              index: item.index,
              delta: { type: "text_delta", text: delta.content },
            }),
      );
    }
    for (const fragment of delta.tool_calls ?? []) {
      let item = this.tools.get(fragment.index);
      if (!item) {
        item = {
          kind: "tool",
          id: "fc_" + randomUUID().replaceAll("-", ""),
          call_id: fragment.id || "call_" + randomUUID().replaceAll("-", ""),
          name: fragment.function?.name ?? "",
          arguments: "",
        };
        this.tools.set(fragment.index, item);
        events.push(...this.startItem(item));
      } else item.name += fragment.function?.name ?? "";
      const args = fragment.function?.arguments ?? "";
      item.arguments += args;
      if (args)
        events.push(
          this.protocol === "responses"
            ? this.event("response.function_call_arguments.delta", {
                item_id: item.id,
                output_index: item.index,
                delta: args,
              })
            : this.event("content_block_delta", {
                index: item.index,
                delta: { type: "input_json_delta", partial_json: args },
              }),
        );
    }
    return events;
  }
  finish() {
    const events = [];
    if (this.protocol === "messages")
      for (const item of this.tools.values()) this.toolInput(item);
    for (const item of this.items) {
      if (this.protocol === "messages") {
        events.push(this.event("content_block_stop", { index: item.index }));
        continue;
      }
      if (item.kind === "text")
        events.push(
          this.event("response.output_text.done", {
            item_id: item.id,
            output_index: item.index,
            content_index: 0,
            text: item.text,
            logprobs: [],
          }),
          this.event("response.content_part.done", {
            item_id: item.id,
            output_index: item.index,
            content_index: 0,
            part: {
              type: "output_text",
              text: item.text,
              annotations: [],
              logprobs: [],
            },
          }),
        );
      else
        events.push(
          this.event("response.function_call_arguments.done", {
            item_id: item.id,
            output_index: item.index,
            name: item.name,
            arguments: item.arguments,
          }),
        );
      events.push(
        this.event("response.output_item.done", {
          output_index: item.index,
          item: this.responseItem(item, "completed"),
        }),
      );
    }
    if (this.protocol === "responses")
      events.push(
        this.event(
          this.finishReason === "length"
            ? "response.incomplete"
            : "response.completed",
          { response: this.result() },
        ),
      );
    else
      events.push(
        this.event("message_delta", {
          delta: {
            stop_reason: this.result().stop_reason,
            stop_sequence: null,
          },
          usage: this.anthropicUsage(),
          usage_known: !!this.usage,
        }),
        this.event("message_stop"),
      );
    return events;
  }
  error(error) {
    if (this.protocol === "messages")
      return this.event("error", {
        error: { type: "api_error", message: error.message },
      });
    return this.event("response.failed", {
      response: {
        ...this.result("failed"),
        error: { code: error.code, message: error.message },
      },
    });
  }
}
