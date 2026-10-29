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

1.9 已兼容 OpenCode 实际请求中的 `promptCacheKey`、48 个工具注册，以及 SDK 附带的元数据。最多支持 128 个函数定义。`promptCacheKey` / `prompt_cache_key` 仅作为兼容提示接收，不作为凭据转发或写入历史。

1.9.1 起不再设置本机输出 Token 上限。客户端的 `max_tokens` / `max_completion_tokens` / `max_output_tokens` 原样转换并转发；未指定时不注入默认值。客户端自身配置的输出预算仍由客户端决定。

## 模型与积分调度

- 按账号地区访问 WorkBuddy 官方主入口，优先读取当前客户端使用的 `/v2/enterprises/personal/models`，必要时回退到个人配置与兼容目录。按官方 CLI 可用列表过滤历史、禁用及图片 / 视频生成模型，不从模型名称猜测权限或添加虚构模型。
- 模型目录缓存 10 分钟；页面 **获取模型** 和 `GET /v1/models?refresh=1` 强制回源。模型查询不发送 AI 对话。
- GLM-5.1 要求显式思考档位；未指定时自动使用官方默认 `medium`，避免上游 `400 / 11150`。显式指定的档位保留；该模型不支持关闭思考，其他模型不会被自动开启思考。
- 仅使用勾选的账号，支持轮询、顺序和优先使用临期积分；相同会话尽量固定账号。新账号不自动加入，国内与国际版不混用。
- 刚查询成功且积分为 0 的账号会被跳过。收到明确的积分不足拒绝、且尚未输出任何响应时，会转到同地区下一个所选账号；账号耗尽或全部不可用时返回错误。未知余额和过期余额仍由官方核验。
- 余额不足会短暂冷却；余额刷新确认充值后可重新使用。模型限流、权限拒绝、连接中断和半截回复不会自动重发。
- **设置 → 常规 → 积分为 0 自动切换账号** 是桌面 WorkBuddy 的独立开关，默认关闭。启用后每 30–60 秒查询所选地区账号，使用已确认的余额，并按正常切换流程退出、备份及恢复登录。API 执行中或一键任务运行时延后切换；不会跨地区换号。

## 限额、安全与记录

1.9.4 起本机不再限制并发和每分钟请求数，多个会话可同时运行；请求体上限 32 MB，一次请求最多 20000 条消息，长会话历史原样转发、不截断。服务不额外限制输出 Token，模型目录保留官方提供的输出能力；旧版保存的限额设置会被忽略。模型能力、上下文上限和实际计费由官方决定。

服务默认关闭，仅监听 `127.0.0.1`，需要随机密钥，拒绝跨站浏览器调用。密钥使用系统加密保存，不出现在状态、日志或普通设置中。轮换后更新客户端。关闭窗口到托盘可继续运行，完全退出后停止。正常退出会等待在途请求，手动停止服务会取消在途请求。

最近 100 条记录仅保存模型、账号、状态、耗时与官方返回的 Token 数，以及消息/工具数量、请求体字节数和输出预算。失败时附官方数字错误码、原始 HTTP 状态与响应类型，不保存提示词、回复、工具描述或凭据。未知用量不按文本估算；Responses 返回空用量，Messages 为保持协议结构使用零占位并附 `usage_known:false`，不把占位计入实际统计。

API 页面展示近 7 / 30 天请求与 Token 趋势、成功率、P50 / P95 延迟和模型分布。图表仅覆盖保留的最近 100 条元数据，累计用量单独显示。本机 API 的 Token 用量按日、账号与模型计入「用量」页的总量、每日趋势与模型排行；积分不会按 Token 推算，仍以官方账单为准。

### 请求被拒绝时

在 **API → 最近请求** 展开失败记录，可查看原始上游状态、官方业务码和请求规模。后续请求成功清除顶部提示后，失败详情仍会保留在最近记录中。旧版记录没有这些字段，不能从旧的通用 403 推断官方具体原因。

| 官方业务码        | 含义与处理                                                                                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `11128` | 官方渠道校验未通过。1.9.6 起转发前把全部 system / developer 文本按顺序合并到首条 user 消息，保留工具定义与其余历史；这保留文本，但改变角色和指令优先级，不保证原语义等价。移除零宽分隔符与身份句改写，`systemGuard` 保留为 0。仅在官方明确拒绝且尚未产生任何输出时，最多换号重试 3 次；仍被拒则返回官方状态。不能据此保证特定 Agent 的完整会话可用或断言重试不计费。 |
| `11136` / `11140` | 分别为模型使用权限与账号限制，请在官方客户端查看权限或反馈。                                                                                                                        |
| `11115`           | 输入与历史超过模型上下文上限，请在调用客户端压缩历史或新建会话。                                                                                                                    |
| `11148` / `11149` | 工具记录缺失或重复，请检查调用客户端保存的工具历史。                                                                                                                                |
| `12153`           | 授权过期。先尝试在同一账号续期一次，失败后重新登录。                                                                                                                                |

没有业务码的 HTML 403 只能确认 HTTP 请求被拒绝，不能直接判断账号被封禁。权限与账号限制拒绝（`11136` / `11140`）不会自动换号或重发；渠道校验（`11128`）只在尚未产生任何输出时按上表换号重放。短文本测试成功也不代表某个 Agent 的完整请求已通过验证。

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
