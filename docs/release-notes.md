WorkBuddy Switch 1.2.0：产品、地区与系统分别适配，保留原猫咪图标和简约灰阶界面。

- 六个独立入口：WorkBuddy、Trae、Qoder 的国内版与国际版；独立账号库、授权域名和数据目录。
- Trae / Qoder 新增真实 UID 识别、官方浏览器授权和授权续期；支持 PKCE、过期与取消、回调状态校验及刷新后的身份验证。
- 网页授权与完整客户端登录资料按 UID 关联。首次切换前请在客户端正常登录并保存一次，未关联时禁用切换。旧版兼容快照继续可用。
- Linux 新增 XDG 路径、原生进程识别、正常退出、系统托盘、开机启动和密钥环加密；不使用 basic_text 降级。
- WorkBuddy 国内版一键领积分、签到、旅行、自动任务、对话、用量与加密备份保留；国际版不调用国内活动接口。

| 系统                      | 文件后缀                                              |
| ------------------------- | ----------------------------------------------------- |
| Apple Silicon / Intel Mac | mac-arm64.dmg / mac-x64.dmg（另有 ZIP）               |
| Windows 10/11 x64         | windows-x64-setup.exe / windows-x64-portable.exe      |
| Linux x64 / ARM64         | linux-x64.AppImage / linux-arm64.AppImage（另有 DEB） |

文件名前缀为 WorkBuddy-Switch-1.2.0-，发布页附 SHA256SUMS.txt。macOS 13+，采用 ad-hoc 签名、尚未 Apple 公证；Windows 尚未 Authenticode 签名。

Linux 需要图形桌面与已解锁的 GNOME Keyring 或 KWallet；厂商客户端是否提供对应系统/架构版本，以其官方发布为准。WorkBuddy 国内版 Linux 由 UOS / 麒麟商店提供。

验证包含隔离账号、协议模拟、加密、恢复、界面与各系统原生 Electron 启动。没有操作用户真实账号做服务端登录验收；官方接口与客户端会变化，网页登录成功和本地文件检查不等于所有厂商版本均已实测。Qoder IDE、独立 CLI 和 Trae SOLO 不复用桌面登录资料。

[使用 Wiki](https://github.com/koi128bit/WorkBuddy-Switch/wiki) · [安全说明](https://github.com/koi128bit/WorkBuddy-Switch/blob/main/SECURITY.md)
