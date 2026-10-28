WorkBuddy Switch 1.9.5：本机 API 新增向量与官方工具接口，长会话不再被 11128 打断。

- 新增 `POST /v1/embeddings`：转发官方向量接口，支持 `bge-m3` 与 `hunyuan-embedding`（1024 维），按 OpenAI 格式返回 `data[].embedding` 与 `usage.prompt_tokens`。单条文本上限 8188 字符（超出由本机直接拒绝，官方此处返回 11353/500），单次最多 2048 条；`encoding_format` 仅支持 `float`，`dimensions` 不生效；目前仅验证国内版账号。
- 向量模型不在官方对话目录中，因此不并入 `GET /v1/models`，客户端需手动填写模型名，避免把它当成对话模型选中。
- 新增 `POST /v1/tools/{agentic_search|knowledge_search|tempkey}`：转发官方 `/agenttool` 接口，请求体与官方客户端一致，响应（含 SSE 流）原样透传；`knowledge_search` 自动附带官方要求的检索票据。
- 区分工具侧错误码：`10034` 归为 `tool_credentials_required`，不再被误判为授权过期而触发重新登录；`10040` 归为 `tool_service_unavailable`（数据源未开通）。
- 修复官方 `11128` 渠道校验拒绝打断长会话：该拒绝是间歇性的，同一份请求体在别的账号或稍后会被正常接受。遮蔽阶梯在单个账号上耗尽后，改用账号池中的下一个账号重放同一份请求体；用户、助手与工具消息始终原样不动。
- 只在官方明确返回 `11128` 且尚未产生任何输出时换号；已经开始输出的拒绝，以及模型权限（11136）、账号限制（11140）、上下文超限（11115）、工具记录异常（11148/11149）仍绝不换号或重发。
- 重放最多换号 3 次，官方大范围拒绝时不会放大成成倍的付费调用；拒绝发生在产生 Token 之前，被拒的重放不产生费用。换号后从未遮蔽的原始请求体重新开始，`systemGuard` 记录最后一次实际生效的间隔。
- 向量与工具请求共用账号池调度、取消、最近请求与按日用量统计。

实际速度与可用性仍取决于所选账号、官方限流、模型上下文与数据源开通情况；上下文超限时官方返回 11115，本机不做额外截断。

提供 Mac Apple Silicon / Intel、Windows x64、Linux x64 / ARM64 的安装包，附 SHA256SUMS.txt。

macOS 使用 ad-hoc 签名、未 Apple 公证，PKG 未签署 Developer ID Installer；Windows 尚未 Authenticode 签名。
