import { createHash } from "node:crypto";
import { ApiError, TOOL_LIMIT } from "./api-upstream.mjs";

const object = (v) => v && typeof v === "object" && !Array.isArray(v);
const invalid = (message) => {
  throw new ApiError(400, "invalid_tool", message);
};
const key = (namespace, name) => JSON.stringify([namespace || "", name]);

// Namespaces and freeform tools belong to the client. Only their wire format
// changes; this registry never executes a tool or retains data across requests.
export class ResponseTools {
  byIdentity = new Map();
  byWire = new Map();
  constructor(tools) {
    if (tools === undefined) return;
    if (!Array.isArray(tools)) invalid("tools 应为数组。");
    const add = (tool, namespace, namespaceDescription) => {
      if (!["function", "custom"].includes(tool?.type))
        throw new ApiError(
          400,
          "unsupported_tool",
          "仅支持客户端 function、custom 和 namespace 工具，托管工具须在客户端关闭。",
        );
      if (
        typeof tool.name !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(tool.name)
      )
        invalid("工具名称无效。");
      const identity = key(namespace, tool.name);
      if (this.byIdentity.has(identity))
        invalid("工具名称在同一命名空间内重复。");
      const wire =
        namespace || tool.name.length > 64 || tool.name.startsWith("wbs_")
          ? "wbs_" +
            createHash("sha256").update(identity).digest("hex").slice(0, 40)
          : tool.name;
      const entry = { type: tool.type, name: tool.name, namespace, wire };
      let parameters = tool.parameters ?? {};
      let description = tool.description;
      if (namespace)
        description = [
          `Tool namespace: ${namespace}; original name: ${tool.name}.`,
          namespaceDescription,
          description,
        ]
          .filter((value) => typeof value === "string" && value)
          .join("\n\n");
      if (tool.type === "custom") {
        const format = tool.format;
        if (format && format.type !== "text" && format.type !== "grammar")
          invalid("custom 工具格式无效。");
        if (
          format?.type === "grammar" &&
          (typeof format.definition !== "string" ||
            !["lark", "regex"].includes(format.syntax))
        )
          invalid("custom 工具语法无效。");
        description = [
          description,
          "Pass the tool's exact raw input in the input string, without a code fence.",
          format?.type === "grammar"
            ? `Input grammar (${format.syntax}):\n${format.definition}`
            : "",
        ]
          .filter(Boolean)
          .join("\n\n");
        parameters = {
          type: "object",
          properties: { input: { type: "string" } },
          required: ["input"],
          additionalProperties: false,
        };
      }
      if (!object(parameters)) invalid("工具参数 schema 无效。");
      entry.definition = {
        type: "function",
        function: {
          name: wire,
          parameters,
          ...(typeof description === "string" ? { description } : {}),
          ...(typeof tool.strict === "boolean" ? { strict: tool.strict } : {}),
        },
      };
      this.byIdentity.set(identity, entry);
      this.byWire.set(wire, entry);
      if (this.byWire.size > TOOL_LIMIT)
        invalid("展开命名空间后最多支持 " + TOOL_LIMIT + " 个工具。");
    };
    for (const tool of tools) {
      if (tool?.type !== "namespace") {
        add(tool);
        continue;
      }
      if (
        !/^[A-Za-z0-9_-]{1,128}$/.test(tool.name ?? "") ||
        !Array.isArray(tool.tools)
      )
        invalid("namespace 工具定义无效。");
      for (const child of tool.tools) add(child, tool.name, tool.description);
    }
  }
  definitions() {
    return [...this.byWire.values()].map((entry) => entry.definition);
  }
  lookup(name, namespace) {
    const entry = this.byIdentity.get(key(namespace, name));
    if (!entry) invalid("历史工具调用与本次工具定义不匹配，请携带原工具定义。");
    return entry;
  }
  call(item) {
    let entry = this.byIdentity.get(key(item.namespace, item.name));
    if (!entry) {
      if (
        !/^[A-Za-z0-9_-]{1,128}$/.test(item.name ?? "") ||
        (item.namespace != null &&
          !/^[A-Za-z0-9_-]{1,128}$/.test(item.namespace))
      )
        invalid("历史工具名称无效。");
      const identity = key(item.namespace, item.name);
      entry = {
        type: item.type === "custom_tool_call" ? "custom" : "function",
        name: item.name,
        namespace: item.namespace,
        wire:
          item.namespace ||
          item.name.length > 64 ||
          item.name.startsWith("wbs_")
            ? "wbs_" +
              createHash("sha256").update(identity).digest("hex").slice(0, 40)
            : item.name,
      };
    }
    if ((item.type === "custom_tool_call") !== (entry.type === "custom"))
      invalid("工具调用类型与定义不匹配。");
    if (entry.type === "custom" && typeof item.input !== "string")
      invalid("custom 工具输入应为文本。");
    return {
      id: item.call_id,
      type: "function",
      function: {
        name: entry.wire,
        arguments:
          entry.type === "custom"
            ? JSON.stringify({ input: item.input })
            : item.arguments,
      },
    };
  }
  choice(choice) {
    if (!object(choice)) return choice;
    if (choice.type === "allowed_tools")
      throw new ApiError(
        400,
        "unsupported_tool_choice",
        "请使用 auto、required 或一个具名工具。",
      );
    const entry = this.lookup(choice.name, choice.namespace);
    return { type: "function", function: { name: entry.wire } };
  }
  output(wire) {
    return this.byWire.get(wire);
  }
}
