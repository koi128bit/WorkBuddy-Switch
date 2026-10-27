WorkBuddy Switch 1.9.1：取消本机 API 的输出 Token 限额。

- 移除 4096 Token 默认值、32768 Token 设置上限及对应设置项。
- Chat Completions、Responses、Anthropic Messages 按客户端传入值转发输出预算；未传入时不注入默认值，使用官方模型默认行为。
- 模型目录保留官方输出能力，旧版输出限额配置不再生效。
- 内置 API 测试不再设置输出预算，账号、设置与 API Key 持续保留。

提供 Mac Apple Silicon / Intel、Windows x64、Linux x64 / ARM64 的安装包，附 SHA256SUMS.txt。

macOS 使用 ad-hoc 签名、未 Apple 公证，PKG 未签署 Developer ID Installer；Windows 尚未 Authenticode 签名。
