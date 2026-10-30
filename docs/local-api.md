# 本机 API

在 **API** 页勾选用于转发的 WorkBuddy 账号，保存设置后启动服务。默认 Base URL 为 `http://127.0.0.1:8317/v1`，密钥通过 **复制 API Key** 获取。账号须完成官方网页登录授权，Trae / Qoder 不参与转发。

## 接口与客户端

| 格式                    | 路径                        | 客户端填写的 Base URL      |
| ----------------------- | --------------------------- | -------------------------- |
| OpenAI Chat Completions | `POST /v1/chat/completions` | `http://127.0.0.1:8317/v1` |
| OpenAI Responses        | `POST /v1/responses`        | `http://127.0.0.1:8317/v1` |
| Anthropic Messages      | `POST /v1/messages`         | `http://127.0.0.1:8317`    |
| OpenAI Embeddings       | `POST /v1/embeddings`       | `http://127.0.0.1:8317/v1` |
| 官方工具                | `POST /v1/tools/{name}`     | 同上                       |
| 模型目录                | `GET /v1/models`            | 同上                       |

也支持无 `/v1` 前缀和尾部斜杠。使用同一密钥，支持 `Authorization: Bearer …` 或 `x-api-key`；同时发送两者时必须一致。

三种对话格式均支持文本、图片、本地函数工具、完整历史、流式与非流式响应。工具在调用客户端执行。本机 Responses 为无状态模式：设置 `store:false` 并发送完整 `input` 历史；不提供 `previous_response_id`、后台任务、托管网页搜索或服务端 shell。Messages 不伪造推理签名；外部服务的加密推理块不能转入本服务。

## 局域网访问（可选）

服务默认只监听 `127.0.0.1`。在 **API → 账号与调度** 打开 **允许局域网访问**、保存设置并重新启动服务后，同一网段的手机、平板、另一台电脑，或本机的容器/虚拟机，可用局域网地址直接调用：

```bash
# 地址取自 API 页「局域网地址」一行，端口跟随后端设置
curl http://192.168.1.20:8317/v1/chat/completions \
  -H "Authorization: Bearer $WORKBUDDY_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model":"auto","messages":[{"role":"user","content":"你好"}]}'
```

- 页面会显示实际可用的 `http://<局域网 IP>:<端口>/v1`，并提供 **复制局域网地址**。没有可用网卡时提示未检测到地址。
- 开启后同时保留回环地址，本机客户端仍可用 `127.0.0.1`。
- 只接受本机与真实网卡地址的 `Host`，其他主机名（含 DNS 重绑定）仍返回 `403 local_clients_only`。
- 仍需 API Key，浏览器跨站请求（带 `Origin` 或 `Sec-Fetch-Site: cross-site`）继续被拒绝。关闭开关即恢复仅回环，不需要重装或清空配置。
- 对外开放范围取决于本机防火墙与路由器；共享网络下建议只用可信网段，并在不使用时关闭开关。系统首次监听非回环地址时可能弹出防火墙授权提示。

## 国内与国际版并行

API 页同时显示两个地区；分别勾选已完成官方网页登录授权的账号，停止服务后保存，再启动。新增账号不会自动加入转发范围。

| 地区 | OpenAI / Codex Base URL | Claude Code Base URL |
| --- | --- | --- |
| 国内版 | `http://127.0.0.1:8317/cn/v1` | `http://127.0.0.1:8317/cn` |
| 国际版 | `http://127.0.0.1:8317/global/v1` | `http://127.0.0.1:8317/global` |

地区地址均使用原始模型 ID，例如 `deepseek-v4.1-flash`。原 `/v1` 统一地址仍用 `global:deepseek-v4.1-flash` 选择国际版。两个地区共用密钥，但账号调度、模型目录与会话亲和绑定独立；国内地址会拒绝国际版前缀。切换工作台左侧客户端不会改变其他 Agent 正在使用的 API 地区。

### Codex

把密钥设置为 `WORKBUDDY_API_KEY` 环境变量，再合并以下配置；不覆盖现有其他 provider。模型使用所选地区目录返回的原始 ID。

```toml
model = "deepseek-v4.1-flash"
model_provider = "workbuddy_global"
web_search = "disabled"

[model_providers.workbuddy_global]
name = "WorkBuddy 国际版"
base_url = "http://127.0.0.1:8317/global/v1"
env_key = "WORKBUDDY_API_KEY"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
```

支持 Responses 的 `function`、`namespace`、`custom` 工具及其结果历史：命名空间和自由文本输入转换为上游函数格式，响应恢复原名称、命名空间、工具类型和原始输入。自定义工具参数会在完成后验证并恢复；工具始终由 Codex 执行。暂不支持服务端托管工具和 WebSocket。

参考 [Codex provider 配置](https://developers.openai.com/codex/config-advanced) 与 [OpenAI 函数及自定义工具协议](https://developers.openai.com/api/docs/guides/function-calling)。

### Claude Code

```bash
ANTHROPIC_BASE_URL='http://127.0.0.1:8317/global' \
ANTHROPIC_API_KEY="$WORKBUDDY_API_KEY" \
ANTHROPIC_AUTH_TOKEN="$WORKBUDDY_API_KEY" \
ANTHROPIC_MODEL='deepseek-v4.1-flash' \
ANTHROPIC_DEFAULT_HAIKU_MODEL='deepseek-v4.1-flash' \
ANTHROPIC_DEFAULT_SONNET_MODEL='deepseek-v4.1-flash' \
ANTHROPIC_DEFAULT_OPUS_MODEL='deepseek-v4.1-flash' \
ENABLE_TOOL_SEARCH=false \
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 claude
```

使用 Messages 协议；支持本地函数、工具结果和图片工具结果。官方托管工具搜索须关闭。若原配置含 `ANTHROPIC_CUSTOM_HEADERS`、其他 OAuth token 或 apiKeyHelper，需避免它们覆盖本次密钥；同时发送 Bearer 和 x-api-key 时必须一致。`POST /global/v1/messages/count_tokens` 可供客户端做预算预估，无需发送 AI 对话；响应头 `X-Token-Count-Estimated: true` 表示它是按请求字节数得到的本机估算，不是官方 tokenizer、实际用量或计费依据，不影响原请求输出预算。

参考 [Claude Code 网关说明](https://code.claude.com/docs/en/llm-gateway)。协议兼容与官方账号是否接受 API 调用分别验收；自 1.9.7 起两者均已通过：官方 OpenAI / Anthropic SDK 契约 20/20（国内与国际各 10 项），Codex CLI 0.159.2 与 Claude Code 2.1.169 在国内版、国际版各跑通一轮工具调用闭环，上游请求全部 200。

## 上游渠道校验（`11128`）

官方 `11128` 有三种不同成因，处理方式互不相同：

| 上游 msg | 触发条件 | 本机处理 |
| --- | --- | --- |
| `first message is not system prompt` | 首条消息不是 system 角色 | 请求形状错误，直接返回 |
| `request illegal` | 缺 `X-Agent-Purpose`、`X-Conversation-Request-ID` 或 `X-Conversation-Message-ID` | 网关按请求补齐三个头，并每次使用新的 UUID |
| `Illegal API invocation from an unapproved channel` | **首条 system 消息的开头**匹配到第三方 Agent 指纹 | 在同一条 system 消息前加一句中性引导语，原文逐字保留、角色仍为 system |

指纹锚点严格按位置判定，与请求长度、tools 数量、消息条数无关；同一段文本放在任何中性前缀之后都会被接受。

第一条 system 消息以「自报身份的 Agent 开场」出现时，网关匹配下面这一族：

| 形态 | 例子 |
| --- | --- |
| `x-anthropic-billing-header:` 开头 | Claude Code 的 billing 头 |
| `You are <Product> Code\|CLI` | `You are Claude Code`、`You are Codex CLI` |
| `You are a/an … agent\|assistant … powered by / built on / running in / running on / based on …` | `You are a coding agent running in the Codex CLI`、`You are a Claude agent, built on Anthropic's Claude Agent SDK`、`You are an AI agent powered by DeepSeek Harness.` |
| 上述句式末尾带 `official CLI` | `You are Claude Code, Anthropic's official CLI for Claude.` |

规则按族匹配而不是按产品名硬编码，新出现的 Agent 客户端不用等网关发版。

除开头匹配之外，官方还会对 system 角色做语义筛查：一份内容正常、但读起来像第三方 Agent 运行时的系统提示词（例如同时出现 teammate 交接与工具编排说明）会被同样拒成 `11128`，此时开头加引导语也没用，而把同一段文字放进 user 角色就能通过。网关因此把这条拒绝做成可恢复路径：命中 `11128` 且请求带 system 消息时，自动改成「中性 system 引导句 + 原 system 原文作为首条 user」重发一次。只重试一次、只对 `11128` 重试，原文逐字保留；其它错误码（`11136`、`12153`、额度类）不重放，流式已开始输出后的拒绝也不重放。
普通系统提示词（含 `You are a helpful assistant.`、`You are an AI agent.`、`You are DeepSeek Harness.` 这类非第三方身份开场，以及 Gemini CLI、GitHub Copilot、Cursor 等中性表述）原样转发，不加任何前缀。

## OpenCode

选择 **OpenAI Compatible**（`@ai-sdk/openai-compatible`），使用 `/v1` 地址。示例合并到现有配置，保留其他 provider；不要把真实密钥提交到仓库。

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "workbuddy": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "WorkBuddy Switch",
      "options": {
        "baseURL": "http://127.0.0.1:8317/v1",
        "apiKey": "{env:WORKBUDDY_API_KEY}"
      },
      "models": {
        "auto": { "name": "WorkBuddy Auto" }
      }
    }
  },
  "model": "workbuddy/auto"
}
```

其他模型使用 **获取模型** 返回的精确 ID，`global:` 前缀仅使用国际版账号。修改 OpenCode 的 provider 配置后，必要时重启该客户端以清除其已缓存的连接配置。配置格式参考 [OpenCode 官方说明](https://opencode.ai/docs/providers/#custom-provider)。

1.9 已兼容 OpenCode 实际请求中的 `promptCacheKey`、48 个工具注册，以及 SDK 附带的元数据。本机最多支持 1024 个展开后的函数定义，适配带较多插件的 Codex；官方接受的工具数量仍由上游决定。`promptCacheKey` / `prompt_cache_key` 仅作为兼容提示接收，不作为凭据转发或写入历史。

1.9.1 起不再设置本机输出 Token 上限。客户端的 `max_tokens` / `max_completion_tokens` / `max_output_tokens` 原样转换并转发；未指定时不注入默认值。客户端自身配置的输出预算仍由客户端决定。

## 模型与积分调度

- 按账号地区访问 WorkBuddy 官方主入口。国内优先读取 `/v2/enterprises/personal/models`；国际优先读取桌面客户端当前使用的 `/v3/config`，旧个人目录仅作回退。排除禁用及图片 / 视频生成模型，保留官方显式账号可用范围；不再用国际版 CLI 的快捷别名子集过滤整个桌面目录。
- 模型目录缓存 10 分钟；页面 **获取模型** 和 `GET /v1/models?refresh=1` 强制回源。模型查询不发送 AI 对话。
- GLM-5.1 要求显式思考档位；未指定时自动使用官方默认 `medium`，避免上游 `400 / 11150`。显式指定的档位保留；该模型不支持关闭思考，其他模型不会被自动开启思考。
- 仅使用勾选的账号，支持轮询、顺序和优先使用临期积分；相同会话尽量固定账号。新账号不自动加入，国内与国际版不混用。
- 刚查询成功且积分为 0 的账号会被跳过。收到明确的积分不足拒绝、且尚未输出任何响应时，会转到同地区下一个所选账号；账号耗尽或全部不可用时返回错误。未知余额和过期余额仍由官方核验。
- 余额不足会短暂冷却；余额刷新确认充值后可重新使用。模型限流（HTTP 429 / 官方 14003 等）在尚未输出任何内容时，会先把该账号与模型冷却，再换用同地区下一个所选账号重放一次；第二个账号仍被限流则把 429 原样返回客户端，不再继续换号，避免把模型级限流放大成重试风暴。权限拒绝、连接中断和半截回复不会自动重发。
- **设置 → 常规 → 积分为 0 自动切换账号** 是桌面 WorkBuddy 的独立开关，默认关闭。启用后每 30–60 秒查询所选地区账号，使用已确认的余额，并按正常切换流程退出、备份及恢复登录。API 执行中或一键任务运行时延后切换；不会跨地区换号。

## 限额、安全与记录

1.9.4 起本机不再限制并发和每分钟请求数，多个会话可同时运行；请求体上限 32 MB，一次请求最多 20000 条消息，长会话历史原样转发、不截断。服务不额外限制输出 Token，模型目录保留官方提供的输出能力；旧版保存的限额设置会被忽略。模型能力、上下文上限和实际计费由官方决定。

服务默认关闭并只监听 `127.0.0.1`；打开 **允许局域网访问** 后才额外接受本机网卡地址，需随机密钥，且始终拒绝跨站浏览器调用。密钥使用系统加密保存，不出现在状态、日志或普通设置中。轮换后更新客户端。关闭窗口到托盘可继续运行，完全退出后停止。正常退出会等待在途请求，手动停止服务会取消在途请求。

最近 100 条记录仅保存模型、账号、状态、耗时与官方返回的 Token 数，以及消息/工具数量、请求体字节数和输出预算。失败时附官方数字错误码、原始 HTTP 状态与响应类型，不保存提示词、回复、工具描述或凭据。未知用量不按文本估算；Responses 返回空用量，Messages 为保持协议结构使用零占位并附 `usage_known:false`，不把占位计入实际统计。

API 页面展示近 7 / 30 天请求与 Token 趋势、成功率、P50 / P95 延迟和模型分布。图表仅覆盖保留的最近 100 条元数据，累计用量单独显示。本机 API 的 Token 用量按日、账号与模型计入「用量」页的总量、每日趋势与模型排行；积分不会按 Token 推算，仍以官方账单为准。

### 请求被拒绝时

在 **API → 最近请求** 展开失败记录，可查看原始上游状态、官方业务码和请求规模。后续请求成功清除顶部提示后，失败详情仍会保留在最近记录中。旧版记录没有这些字段，不能从旧的通用 403 推断官方具体原因。

| 官方业务码        | 含义与处理                                                                                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `11128` | 官方渠道校验未通过，保留原始状态与业务码。网关已按上节补齐三头，并对第三方 Agent 身份开场加中性引导语；仍被拒绝时不换号、不改写提示词，请在官方客户端核对本次请求与授权。 |
| `11136` / `11140` | 分别为模型使用权限与账号限制，请在官方客户端查看权限或反馈。                                                                                                                        |
| `11115`           | 输入与历史超过模型上下文上限，请在调用客户端压缩历史或新建会话。                                                                                                                    |
| `11148` / `11149` | 工具记录缺失或重复，请检查调用客户端保存的工具历史。                                                                                                                                |
| `12153`           | 授权过期。先尝试在同一账号续期一次，失败后重新登录。                                                                                                                                |

没有业务码的 HTML 403 只能确认 HTTP 请求被拒绝，不能直接判断账号被封禁。渠道、权限与账号限制拒绝不会自动换号或重发。短文本测试成功也不代表某个 Agent 的完整请求已通过验证。

```bash
curl http://127.0.0.1:8317/v1/chat/completions \
  -H "Authorization: Bearer $WORKBUDDY_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model":"auto","messages":[{"role":"user","content":"你好"}]}'
```

## 向量

`POST /v1/embeddings`，请求体与 OpenAI 一致。可用模型为 `bge-m3` 与 `hunyuan-embedding`，均输出 1024 维，返回 `data[].embedding` 浮点数组与 `usage.prompt_tokens`。向量模型不在官方对话模型目录中，`GET /v1/models` 不列出它们，客户端需手动填写模型名。

- 单条文本最长 8188 字符，超长请先切块；超出会在本机直接拒绝，不会转发。
- 一次请求最多 2048 条输入，可用字符串、字符串数组或 token 数组；`dimensions` 不生效，`encoding_format` 仅支持 `float`（官方不接受 `base64`）。
- 目前仅验证国内版账号可用，`global:` 前缀会被拒绝。

```bash
curl http://127.0.0.1:8317/v1/embeddings \
  -H "Authorization: Bearer $WORKBUDDY_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model":"bge-m3","input":["第一条","第二条"]}'
```

## 官方工具

`POST /v1/tools/{name}` 转发官方 `/agenttool` 接口，请求体与官方客户端一致，响应原样透传（流式接口保持 SSE）。

| 工具               | 必填字段 | 说明                                                              |
| ------------------ | -------- | ----------------------------------------------------------------- |
| `agentic_search`   | `query`  | 多来源联网研究，`stream` 默认 `true`；可传 `search_mode`、`biz_via` |
| `knowledge_search` | `query`  | 检索账号内部资料库；`sources` 可选，默认由官方决定可使用源        |
| `tempkey`          | 无       | 获取临时密钥                                                      |

工具在当前所选账号上执行，配额与权限由官方决定；数据源未开通时官方返回 `10040`，本机映射为 `tool_service_unavailable`。检索凭据问题返回 `10034` → `tool_credentials_required`，不会被当作登录失效。

```bash
curl http://127.0.0.1:8317/v1/tools/agentic_search \
  -H "Authorization: Bearer $WORKBUDDY_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"query":"研究 A 股半导体设备行业整体情况","stream":false}'
```
