WorkBuddy Switch 1.0：支持 macOS 与 Windows 的 WorkBuddy 多账号管理应用。

- 全部界面统一为简洁原生灰阶风格：账号、积分、对话、用量、设置，支持浅色、深色、跟随系统与紧凑布局。
- 保留原猫咪应用图标，增加菜单栏快捷面板、当前积分数字和底部状态栏。
- 一键领积分：多选账号签到与领取已到达的旅行奖励，记录真实结果；未返回金额时明确显示。
- 猫猫旅行：官方地点选择、出发、状态查询、领奖与账号独立的自动任务设置。
- 自动签到、旅行领奖与出发默认关闭，应用运行时按所选时间和间隔执行。
- 官方网页登录添加账号、加密保存、收藏与备注、安全切换、官方积分和到期提醒。
- WorkBuddy 5.6 本机加密凭据支持，跨设备密码加密备份、旧版 macOS 账号迁入。
- 本地对话恢复与跨账号续聊，迁移前备份完整数据库。
- Token 统计覆盖消息与工具调用，按记录 ID 去重，支持时间筛选、模型与对话排行及 CSV。

| 设备              | 下载文件                                                                 |
| ----------------- | ------------------------------------------------------------------------ |
| Apple Silicon Mac | `mac-arm64.dmg` 或 `mac-arm64.zip`                                       |
| Intel Mac         | `mac-x64.dmg` 或 `mac-x64.zip`                                           |
| Windows 10/11 x64 | `windows-x64-setup.exe`（安装版）或 `windows-x64-portable.exe`（便携版） |

完整文件名以 `WorkBuddy-Switch-1.0.0-` 开头，macOS 需要 13 或更高版本。下载后可对照 `SHA256SUMS.txt`。

macOS 使用 ad-hoc 签名，尚未做 Apple 公证；Windows 包尚未做 Authenticode 签名，首次打开可能出现系统提示。

签到与旅行适用于国内版活动，资格和奖励以官方为准。自动任务需要应用持续运行，电脑休眠或完全退出后停止，不保证固定奖励金额。

从 0.x 升级：在 macOS「设置 → 数据与备份」迁入旧版账号，原数据保留。本机加密账号库不能直接跨系统复制，请使用 `.wbsbackup` 密码备份；本机封装凭据需先通过网页登录重新授权才能导出。

跨账号续聊会迁移选中记录的本地归属，原账号不再拥有该记录，不生成副本，也不同步云端权限。

[使用 Wiki](https://github.com/koi128bit/WorkBuddy-Switch/wiki) · [安全与隐私](https://github.com/koi128bit/WorkBuddy-Switch/blob/main/SECURITY.md) · [反馈问题](https://github.com/koi128bit/WorkBuddy-Switch/issues)
