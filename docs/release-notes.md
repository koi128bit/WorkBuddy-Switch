WorkBuddy Switch 1.1.0：统一管理 WorkBuddy、Trae CN 与 Qoder CN，支持 macOS 和 Windows。

- 新增 Trae CN 与 Qoder CN 本机登录快照：保存、命名、备注、收藏、搜索、安全切换。
- 主窗口和菜单栏都可选择客户端，底部状态栏同步切换；保留简约灰阶风格与原猫咪图标。
- 切换前保存原登录；退出失败停止写入，启动失败尝试恢复，中断时保留系统加密恢复记录。
- 国内版独立目录与应用校验，支持 Windows Qoder CN 启动器及手动路径配置。
- WorkBuddy 新增需关注筛选、积分包明细和临期优先建议；原有一键领积分、猫猫旅行、自动任务、对话续接及用量功能保留。

Trae CN / Qoder CN 快照仅限同机恢复，不解密原客户端私有凭据，不在 WorkBuddy 的跨设备备份中导出。请按客户端显示的账号命名，恢复后由客户端确认登录状态。国际版、SOLO、Qoder CLI 不在本次范围。

本机只读核验了 Trae CN 3.3.95；账号切换使用隔离文件与模拟进程验证，未切换用户真实账号。本机未安装 Qoder CN。Windows 原生启动、加密及打包由 Windows runner 验证。

| 设备              | 下载文件后缀                                         |
| ----------------- | ---------------------------------------------------- |
| Apple Silicon Mac | `mac-arm64.dmg` / `mac-arm64.zip`                    |
| Intel Mac         | `mac-x64.dmg` / `mac-x64.zip`                        |
| Windows 10/11 x64 | `windows-x64-setup.exe` / `windows-x64-portable.exe` |

完整文件名以 `WorkBuddy-Switch-1.1.0-` 开头。macOS 13+；发布页附 SHA256SUMS.txt。

macOS 使用 ad-hoc 签名，尚未 Apple 公证；Windows 尚未 Authenticode 签名。自动签到和旅行任务默认关闭，仅在应用运行且电脑未休眠时执行。

[使用 Wiki](https://github.com/koi128bit/WorkBuddy-Switch/wiki) · [安全说明](https://github.com/koi128bit/WorkBuddy-Switch/blob/main/SECURITY.md)
