# OpenUsage

OpenUsage 是面向 WorkBuddy 的原生 macOS 账号、对话与用量管理器。界面借鉴
CC Switch 的紧凑信息架构，并以原创的光谱流带实现清亮、低干扰的动态风格。

## 功能

- 账号快切：捕获当前 WorkBuddy 登录状态到 macOS 钥匙串，切换时自动保存
  出站账号、原子替换凭据并重启 WorkBuddy。
- 对话恢复：读取 `~/.workbuddy/workbuddy.db`，支持账号和目录筛选、回收站恢复、
  `workbuddy://chat/<session-id>` 快速继续，以及终端 `--resume` 回退。
- Token 用量：流式解析 `~/.workbuddy/projects/**/*.jsonl`，展示净输入、输出、
  缓存命中、思考 token、Credits、模型和对话排行。
- 账号额度：按需读取当前 WorkBuddy 凭据并查询周期额度，不存储 token 或远程响应。
- 菜单栏：快速查看用量、额度和切换账号。

## 兼容性

- macOS 13 Ventura 或更高版本
- WorkBuddy macOS 桌面版；当前在 WorkBuddy 5.3.3 上验证
- 当前发布产物为 Universal（Apple Silicon + Intel）。传入
  `OPENUSAGE_ARCHS="arm64 x86_64"` 时，脚本会分别构建两个架构并通过
  `lipo` 合并；该流程只需 Apple Command Line Tools 和 Swift 5.10+。

## 安装

从 Releases 下载 DMG，将 OpenUsage 拖入 Applications。

默认构建使用 ad-hoc 签名，未经过 Apple 公证，因此从网络下载后不能通过
Gatekeeper 的常规双击检查。首次打开时可在 Finder 中右键 OpenUsage 并选择
“打开”；这类产物只适合本地测试。面向其他用户分发时，应通过下方环境变量
启用 Developer ID 签名与 Apple 公证。

## 本地构建

只需要 Apple Command Line Tools 和 Swift 5.10+：

```bash
scripts/test.sh
scripts/build-release.sh
```

产物位于 `dist/`。

Developer ID 构建：

```bash
OPENUSAGE_SIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)" \
OPENUSAGE_NOTARY_PROFILE="notary-profile" \
OPENUSAGE_ARCHS="arm64 x86_64" \
scripts/build-release.sh
```

## 数据口径

每条 assistant 消息读取 `providerData.rawUsage`：

```text
净输入 = prompt_tokens - prompt_cache_hit_tokens
输出   = completion_tokens
缓存读 = prompt_cache_hit_tokens
思考   = completion_thinking_tokens（输出的子集）
总量   = prompt_tokens + completion_tokens
```

会话 ID 通过 SQLite `sessions.user_id` 映射到账号。重复文件优先使用消息 ID
去重，缺少消息 ID 时使用稳定内容哈希，避免恢复或复制记录后重复计数。

## 隐私与安全

详见 [SECURITY.md](SECURITY.md)。OpenUsage 不包含 WorkBuddy 账号、对话、
数据库、JSONL 或认证快照；`.gitignore` 对这些格式做了额外防护。

## 致谢与许可

OpenUsage 以 MIT License 发布。参考项目及固定修订见
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

OpenUsage 是独立项目，不隶属于腾讯、WorkBuddy、Kimi、CC Switch 或 usageBar。
