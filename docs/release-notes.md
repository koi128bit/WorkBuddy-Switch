WorkBuddy Switch 1.0：专注 WorkBuddy 的多账号桌面工作台。

- 全新工作台、账号卡片、对话记录、用量分析与五类设置。
- 保存当前登录或通过官方网页登录添加，支持本机快切、收藏、备注、积分与到期提醒。
- 识别 WorkBuddy 5.6 的本机加密凭据；网页登录授权用于积分查询及跨设备加密备份。
- 本地对话恢复与跨账号续聊，迁移前自动完整备份数据库。
- 消息去重、准确 Token 分项、模型与对话排行、日期筛选及 CSV 导出。
- 系统启动、托盘、主题、隐私、自动刷新、路径诊断与备份设置。

| 设备 | 下载文件 |
| --- | --- |
| Apple Silicon Mac | `mac-arm64.dmg` 或 `mac-arm64.zip` |
| Intel Mac | `mac-x64.dmg` 或 `mac-x64.zip` |
| Windows 10/11 x64 | `windows-x64-setup.exe`（安装版）或 `windows-x64-portable.exe`（便携版） |

完整文件名均以 `WorkBuddy-Switch-1.0.0-` 开头。macOS 需要 13 或更高版本。

macOS 使用 ad-hoc 签名，未做 Apple 公证；Windows 包未做 Authenticode 签名，首次打开可能提示未知发布者。下载后可对照 `SHA256SUMS.txt` 校验。

从 0.x 升级：在 macOS「设置 → 数据与备份」迁入旧版账号，旧数据会保留。本地加密账号库不能直接跨系统复制，请使用 `.wbsbackup` 密码加密备份；本机封装凭据需要先通过网页登录重新授权才能导出。

跨账号续聊会把所选本地记录移到当前账号，原账号不再拥有该记录；它不是副本，也不同步云端权限。

[使用 Wiki](https://github.com/koi128bit/WorkBuddy-Switch/wiki) · [安全与隐私](https://github.com/koi128bit/WorkBuddy-Switch/blob/main/SECURITY.md) · [反馈问题](https://github.com/koi128bit/WorkBuddy-Switch/issues)
