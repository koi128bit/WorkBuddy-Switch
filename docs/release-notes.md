WorkBuddy Switch 1.7.0：内置 OpenAI 兼容的本机 API。

- 新增 API 页面，选择账号、设置端口和限额，一键启动或停止服务。
- 支持 /v1/models、/v1/chat/completions、流式与非流式回复、工具调用和图像输入，模型能力以官方为准。
- 国内与国际版账号分开路由，国际版模型使用 global: 前缀；支持轮询、顺序使用、临期积分优先和会话粘性。
- 独立 API Key 由系统加密保存，默认只监听本机；提供密钥轮换、限流、并发限制和脱敏请求记录。
- 测试对话最多输出 64 Token；付费请求结果不明时不会自动重发。
- 保留原猫咪图标、账号设置与 1.6 的任务能力，Mac / Windows 继续覆盖升级。

提供 Mac Apple Silicon / Intel、Windows x64、Linux x64 / ARM64 的 12 个安装包，附 SHA256SUMS.txt。当前不支持 Responses、Anthropic Messages、Embeddings 或公网监听。上游可能拒绝非官方调用通道，实际可用模型、权限和计费以官方为准。

macOS 使用 ad-hoc 签名、未 Apple 公证，PKG 未签署 Developer ID Installer；Windows 尚未 Authenticode 签名。
