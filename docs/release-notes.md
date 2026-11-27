WorkBuddy Switch 2.0.2 新增千问办公（QwenWork）桌面账号切换和本机 API 转发。

**切换千问办公账号**

在千问办公桌面端登录第一个账号，回到 WorkBuddy Switch 选择「千问办公 → 保存当前账号」并命名。第二个账号同样操作，之后即可从账号列表或系统托盘切换。Windows 默认识别 `%APPDATA%\QwenWorkCN`。工具在本机加密保存登录快照，并支持恢复切换前的登录状态。切换前请先结束千问办公中正在运行的任务。

**连接本机 API**

在「千问办公 → API」选择上游，启动服务后复制本机地址和密钥。默认地址为 `http://127.0.0.1:8317/qwenwork/v1`。API 使用单独配置的上游授权。

- OpenAI 兼容模式连接本机运行的 qwenwork2api，支持模型列表、普通对话和流式对话。[qwenwork2api 接口说明](https://github.com/jianhx189/qwenwork2api)
- 开放平台模式使用应用用户访问令牌直连官方云端会话，可创建会话、发送提示和订阅事件。[千问办公开放平台文档](https://docs.qwenwork.cn/developer-standard/open-api)

**下载**

Windows x64 可选 `windows-x64-setup.exe` 安装版或 `windows-x64-portable.exe` 便携版。macOS 提供 Apple 芯片和 Intel 版本，Linux 提供 x64 和 ARM64 版本。附件 `SHA256SUMS.txt` 列出了各安装包的校验值。

账号切换和失败恢复已用隔离的登录快照验证，流式转发已通过本机 HTTP 测试。已在 macOS 识别千问办公 2.2.1。Windows 上两个真实千问办公账号之间的切换，以及使用有效开放平台令牌完成云端对话，仍待实测。
