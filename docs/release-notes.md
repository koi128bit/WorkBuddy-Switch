WorkBuddy Switch 1.9.0：OpenCode 接入、零积分换号与任务连续执行。

- 修复 OpenCode 实际请求中的 promptCacheKey 和 48 个工具被拒绝；支持最多 128 个函数定义，输出预算截到本机上限。
- 新增 OpenAI Responses 与 Anthropic Messages，支持流式文本、工具参数、图片输入与实际用量；与 Chat Completions 共用密钥、限流和账号池。
- 模型、活动与任务对话按地区使用 WorkBuddy 主入口。优先读取当前个人模型目录，修复 Hy4、GLM-5.3、DeepSeek V4.1 等新模型缺失；过滤禁用与非对话模型，页面显示精确 ID，获取模型强制回源。
- API 自动跳过新鲜零余额账号；明确积分不足且未产生任何输出时切换同地区已选账号。保留不自动重发中断或未知计费请求的边界。
- 新增设置中的桌面零积分自动切换开关，使用正常退出、快照与回滚流程。
- 已知任务未返回进度时先显示预留上限，解锁后读取官方进度；未确认接取的任务可随前置任务推进重新接取，最多检查 30 轮。公众号关注、活动协议和付款保留本人操作。
- 修复已安装技能目录接口 404，使用当前资产标识；任务普通对话改用官方自动模式。
- 保留红紫猫咪图标、正常 Dock 尺寸、Raycast Dark 毛玻璃布局、账号与密钥。

已通过真实 OpenCode 验证 DeepSeek V4.1 Flash 的流式对话、文件读取工具与结果回传。模型目录可见不代表每个账号均获授权；请使用精确模型 ID，修改 OpenCode 配置后重启客户端刷新缓存。

提供 Mac Apple Silicon / Intel、Windows x64、Linux x64 / ARM64 的安装包，附 SHA256SUMS.txt。

macOS 使用 ad-hoc 签名、未 Apple 公证，PKG 未签署 Developer ID Installer；Windows 尚未 Authenticode 签名。
