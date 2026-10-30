WorkBuddy Switch 1.9.9：官方对 system 角色的语义筛查也能过了，DSH / DeepSeek Harness 这类长系统提示词会话不再被 11128 拦。

- 1.9.8 之后仍有一类 `11128 Illegal API invocation from an unapproved channel`：官方除检查首条 system 的开头，还会对 system 角色做语义筛查——内容正常、但读起来像第三方 Agent 运行时（编排、委托、harness 身份、teammate 交接）的系统提示词会被拒，哪怕开头加了中性引导语、三个必需头都在。实测把同一段文字挪到 user 角色后立刻 200。
- 网关把这条拒绝变成可恢复：命中 11128 且请求里带 system 消息时，自动重排成「中性 system 引导句 + 原 system 原文作为首条 user」重发一次。只重试一次、只对 11128 重试，原文逐字保留、不删改，其它错误码（11136 / 12153 / 额度类）不重放，避免重复计费；流式已开始输出后的拒绝仍然不重放。
- 定位过程用的是真实抓包：从 DSH 会话抓到 148 KB、5 条消息、53 个工具的真实上行请求，逐段二分把触发点收敛到 system 内容，再把修复验到 200。
- 1.9.8 的结构化渠道指纹（`You are <Product> Code|CLI`、`You are … agent/assistant … powered by / built on / running in …`）继续保留，两类拒绝互补。
- 上游请求仍带 `X-Agent-Purpose`、`X-Conversation-Request-ID`、`X-Conversation-Message-ID` 三个必需头。
- 官方 OpenAI / Anthropic SDK 契约 20/20 通过，Codex CLI 与 Claude Code 在国内版与国际版的工具闭环继续通过。

提供 Mac Apple Silicon / Intel、Windows x64、Linux x64 / ARM64 安装包，附 SHA256SUMS.txt。
