WorkBuddy Switch 1.9.4：取消本机 API 的并发与频率限制，修复长会话被本机校验拒绝。

- 去掉并发上限和每分钟请求上限，多个会话可同时运行；不再返回 429 concurrency_limit / local_rate_limit。旧配置中的两项会被忽略，页面不再显示。
- `messages` 上限由 2000 条提高到 20000 条，长会话历史原样转发；此前超过 2000 条的会话会报 `messages 应包含 1–2000 条消息`。
- 请求体上限由 8 MB 提高到 32 MB；Responses / Messages 的数组上限同步提高到 20000，工具结果与历史无需提前裁剪。
- 本机 API 的 Token 用量并入「用量」页：按日、账号、模型统计输入/输出与请求数，同时计入总量、每日趋势与模型排行；积分仍只取客户端日志中的显式 Credits。
- 同一账号可同时承载多个会话，账号数少于会话数时不再返回 503；会话粘性、积分冷却与"失败不重发"保持不变。
- 系统提示词遮蔽、账号调度、Token 与计费口径、错误码映射与 1.9.3 一致。

实际可跑多快仍取决于所选账号、官方限流与模型上下文；上下文超限时官方会返回 11115，本机不做额外截断。

提供 Mac Apple Silicon / Intel、Windows x64、Linux x64 / ARM64 的安装包，附 SHA256SUMS.txt。

macOS 使用 ad-hoc 签名、未 Apple 公证，PKG 未签署 Developer ID Installer；Windows 尚未 Authenticode 签名。
