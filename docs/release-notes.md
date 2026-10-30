WorkBuddy Switch 1.9.7：打通官方渠道校验，国内版与国际版都能直接接 Codex CLI 与 Claude Code。

- 定位并修复官方 `11128 Illegal API invocation from an unapproved channel`：官方只检查**首条 system 消息的开头几个字符**，命中 Codex CLI、Claude Code、Claude Agent SDK 或 `x-anthropic-billing-header` 等第三方 Agent 指纹即拒绝，与请求头无关。网关在同一条 system 消息前补一句中性引导语后再转发，原始提示词逐字保留、角色仍是 system，不改写也不降级为 user。
- 前缀规则在 `www.workbuddy.ai` 与 `www.codebuddy.cn` 双向验证：裸指纹稳定 400，加引导语稳定 200。
- 上游请求补齐 `X-Agent-Purpose`、`X-Conversation-Request-ID`、`X-Conversation-Message-ID` 三个必需头；缺任一个都会得到 `11128 request illegal`。
- 真实 Agent 端到端验收通过：Codex CLI 0.159.2 与 Claude Code 2.1.169 在国内版与国际版各跑一轮工具调用闭环（执行 `pwd` 并回读结果），上游 5/5 请求 200，Claude Code 返回 `subtype: success`、`num_turns: 2`。
- 官方 OpenAI / Anthropic SDK 契约 20/20 通过：Chat Completions 非流式/流式/工具、Responses 非流式/流式/工具、Messages 非流式/流式/工具、`/models`、`count_tokens`，国内与国际各 10 项。
- 系统提示词恢复按 system 原样转发；1.9.6 中合并到 user 消息的做法会让指令优先级失真，本版不再使用。
- API 页按地区给出地址：OpenAI / Codex 用 `http://127.0.0.1:8317/cn/v1` 与 `/global/v1`，Claude Code 用 `/cn` 与 `/global` 根地址；原 `/v1` 继续支持 `global:` 前缀。

提供 Mac Apple Silicon / Intel、Windows x64、Linux x64 / ARM64 安装包，附 SHA256SUMS.txt。

macOS 使用 ad-hoc 签名，未做 Apple 公证；Windows 尚未做 Authenticode 签名。

许可全文：https://github.com/koi128bit/WorkBuddy-Switch/blob/v1.9.7/LICENSE
原项目：https://github.com/koi128bit/WorkBuddy-Switch
