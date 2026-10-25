import { randomUUID } from "node:crypto";
import { apiOrigin } from "./quota.mjs";
import { requestReward, RewardError } from "./rewards.mjs";
const proofs = new WeakMap();
const allowedModels = new Set(["fast-model", "glm-5.2"]);
export function dialogueSpec(task, now = Date.now()) {
  if (
    task.claimed ||
    task.locked ||
    task.claimable ||
    !task.hasReward ||
    !["not_accepted", "accepted", "in_progress"].includes(task.status) ||
    !Number.isSafeInteger(task.current) ||
    !Number.isSafeInteger(task.target) ||
    task.current < 0 ||
    task.target <= task.current
  )
    return null;
  let model, modelName;
  if (task.code === "chat_5") {
    model = "fast-model";
    modelName = "快速模式";
  } else if (task.code === "Model_chat_GLM5.2") {
    model = "glm-5.2";
    modelName = "GLM-5.2";
  } else if (task.code === "black_cat") {
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Shanghai",
        hour: "2-digit",
        hourCycle: "h23",
      }).format(now),
    );
    if (hour >= 8 && hour < 23) return null;
    model = "fast-model";
    modelName = "快速模式";
  } else return null;
  return {
    model,
    modelName,
    remaining: Math.min(20, task.target - task.current),
  };
}
function domesticOrigin(document) {
  const origin = apiOrigin(document);
  if (!new URL(origin).hostname.endsWith(".cn"))
    throw new RewardError("对话任务目前仅支持 WorkBuddy 国内版。", "input");
  if (!document.token)
    throw new RewardError(
      "请先通过官方网页登录授权，再执行对话任务。",
      "credential",
    );
  return origin;
}
const tokens = (value) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
export async function sendDialogue(
  document,
  { model, prompt, expertId },
  request = fetch,
) {
  const origin = domesticOrigin(document);
  if (!allowedModels.has(model))
    throw new RewardError("对话模型不在确认范围内。", "input");
  if (
    expertId !== undefined &&
    (typeof expertId !== "string" ||
      !/^[A-Za-z0-9_.-]{1,160}$/.test(expertId) ||
      expertId.includes(".."))
  )
    throw new RewardError("专家标识无效。", "input");
  if (
    typeof prompt !== "string" ||
    !prompt.trim() ||
    prompt.length > 200 ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(prompt)
  )
    throw new RewardError("对话内容须为 1–200 个字符。", "input");
  const conversationId = randomUUID(),
    startedAt = Date.now();
  let response;
  try {
    response = await request(
      "https://copilot.tencent.com/v2/chat/completions",
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(60000),
        headers: {
          Authorization: `Bearer ${document.token}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "User-Agent": "WorkBuddy-Switch",
          "X-User-Id": document.id,
          "X-Domain": new URL(origin).hostname,
          "X-Product": "SaaS",
          "X-Agent-Intent": "craft",
          "X-Agent-Type": "main",
          "X-Conversation-ID": conversationId,
          "X-Request-ID": randomUUID(),
          ...(expertId ? { "X-Expert-Id": expertId } : {}),
        },
        body: JSON.stringify({
          model,
          agent: "cli",
          messages: [{ role: "user", content: prompt }],
          stream: true,
          stream_options: { include_usage: true },
          max_tokens: 64,
        }),
      },
    );
  } catch {
    throw new RewardError(
      "对话请求中断，消耗与结果尚未确认，已停止继续调用。",
      "transport",
    );
  }
  if ([401, 403].includes(response.status))
    throw new RewardError("对话授权已失效，请重新网页登录。", "auth");
  if (!response.ok)
    throw new RewardError(
      `官方对话服务不可用（HTTP ${response.status}），已停止继续调用。`,
      [402, 429].includes(response.status) ? "quota" : "service",
    );
  let bytes = 0,
    buffer = "",
    requestId = "",
    content = false,
    finished = false,
    done = false,
    inputTokens = null,
    outputTokens = null,
    actualModel = model;
  const accept = (obj) => {
    if (obj?.error)
      throw new RewardError(
        "官方对话返回错误，请在客户端确认模型与余额。",
        "service",
      );
    if (typeof obj?.id === "string" && /^[A-Za-z0-9_.:-]{1,200}$/.test(obj.id))
      requestId = obj.id;
    if (typeof obj?.model === "string" && allowedModels.has(obj.model))
      actualModel = obj.model;
    const choice = obj?.choices?.[0],
      text = choice?.delta?.content ?? choice?.message?.content;
    if (typeof text === "string" && text.trim()) content = true;
    if (choice?.finish_reason) {
      if (!["stop", "length"].includes(choice.finish_reason))
        throw new RewardError("对话未正常完成，已停止继续调用。", "service");
      finished = true;
    }
    if (obj?.usage) {
      inputTokens = tokens(obj.usage.prompt_tokens);
      outputTokens = tokens(obj.usage.completion_tokens);
    }
  };
  const line = (value) => {
    if (!value.startsWith("data:")) return;
    const data = value.slice(5).trim();
    if (data === "[DONE]") {
      done = true;
      return;
    }
    if (!data) return;
    let obj;
    try {
      obj = JSON.parse(data);
    } catch {
      throw new RewardError(
        "对话流返回了无法解析的数据，结果尚未确认。",
        "format",
      );
    }
    accept(obj);
  };
  const reader = response.body?.getReader();
  if (!reader)
    throw new RewardError("未取得完整对话流，结果尚未确认。", "format");
  try {
    const decoder = new TextDecoder();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 2 * 1024 * 1024)
        throw new RewardError("对话响应超过读取上限，结果尚未确认。", "format");
      buffer += decoder.decode(chunk.value, { stream: true });
      if (response.headers.get("content-type")?.includes("application/json"))
        continue;
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        line(buffer.slice(0, end).trim());
        buffer = buffer.slice(end + 1);
        if (done) {
          buffer = "";
          break;
        }
      }
      if (done) break;
    }
    if (!done) buffer += decoder.decode();
    if (response.headers.get("content-type")?.includes("application/json")) {
      let obj;
      try {
        obj = JSON.parse(buffer);
      } catch {
        throw new RewardError("对话返回了无法解析的数据。", "format");
      }
      accept(obj);
    } else if (buffer.trim()) line(buffer.trim());
  } catch (error) {
    if (error instanceof RewardError) throw error;
    throw new RewardError(
      "对话流中断，消耗与结果尚未确认，已停止继续调用。",
      "transport",
    );
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (!requestId || !content || (!done && !finished))
    throw new RewardError(
      "未取得完整对话结果，消耗尚未确认，已停止继续调用。",
      "format",
    );
  const result = Object.freeze({
    conversationId,
    requestId,
    model: actualModel,
    requestedModel: model,
    startedAt,
    inputLength: [...prompt].length,
    inputTokens,
    outputTokens,
  });
  proofs.set(result, { accountId: document.id, origin, reported: false });
  return result;
}
export async function reportDialogue(
  document,
  result,
  request = fetch,
  reporter = null,
) {
  const origin = domesticOrigin(document),
    proof = proofs.get(result);
  if (
    !proof ||
    proof.reported ||
    proof.accountId !== document.id ||
    proof.origin !== origin
  )
    throw new RewardError("只允许记录本次真实完成的对话。", "input");
  proof.reported = true;
  try {
    if (reporter) {
      await reporter(document, result);
      return;
    }
    await requestReward(
      document,
      "/v2/report",
      "POST",
      [
        {
          eventCode: "chat_request_send",
          timestamp: result.startedAt,
          reportDelay: Math.max(0, Date.now() - result.startedAt),
          conversationId: result.conversationId,
          requestId: result.requestId,
          rootRequestId: result.requestId,
          userId: document.id,
          requestModelId: result.model,
          requestModelName: result.model === "glm-5.2" ? "GLM-5.2" : "快速模式",
          inputLength: result.inputLength,
          mode: "craft",
          agentName: "workbuddy-switch",
          agentType: "conversation",
        },
      ],
      request,
    );
  } catch (error) {
    if (error.kind === "auth") proof.reported = false;
    throw error;
  }
}
