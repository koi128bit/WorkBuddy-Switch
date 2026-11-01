WorkBuddy Switch 2.0.1：修掉 Codex 接进来第一句话就报错的问题。

**Codex 不再被托管工具卡住**

- 之前用 CC Switch 或直接配 Codex 接本机 API，第一轮就会收到 `400 仅支持客户端 function、custom 和 namespace 工具，托管工具须在客户端关闭。`。原因是 Codex 走 `responses` 协议时默认会带上 `{"type":"web_search","external_web_access":false}`，网关在解析工具列表阶段直接拒绝了整个请求。
- 现在托管工具被**静默忽略**而不是报错：`web_search`、`web_extraction`、`file_search`、`local_shell`、`shell`、`code_interpreter`、`code_execution`、`image_generation`、`computer`、`mcp`、`memory`、`text_editor`、`bash`、`apply_patch` 全部跳过。你自己声明的 `function`、`custom`、`namespace` 工具照旧展开并转发，行为不变。
- 如果一轮请求里除托管工具外没有别的工具，`tools` 字段整体省略，不会向上游发空数组。
- 续聊也修了：Responses 历史里的 `web_search_call`、`file_search_call`、`local_shell_call`、`image_generation_call`、`mcp_call` 这类条目会被跳过，不再中断对话。
- Messages 协议同步放宽，`web_search_20250305`、`bash_20250124`、`text_editor_20250728`、`computer_20250124`、`code_execution_*` 与 `server_tool_use` / `*_tool_result` 历史块被忽略，Claude Code 侧不用再手动关托管工具。

**验证**

- 用真实 Codex CLI 0.159.2 抓到的原始 58 KB 请求载荷（`namespace multi_agent_v1` + 7 个 `function` + 1 个 `web_search`）回归：改动前稳定 400 `unsupported_tool`，改动后上游 200。
- `codex exec` 端到端跑通，输出 `CODEX_OK`，`turn.completed` 用量 14802 输入 / 3 输出。
- 新增 3 条测试覆盖托管工具剔除、纯托管工具下 `tools` 省略、托管工具历史跳过；全量 368 项通过。
