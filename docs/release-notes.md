WorkBuddy Switch 1.3.0：WorkBuddy 国内版新增一键做任务，保留原猫咪图标和简约灰阶界面。

- 账号页勾选账号后点击「一键做任务」；积分页可对当前选中账号执行。
- 串联每日签到、已到达旅行领奖、成长任务接取和已达标任务领奖；旅行空闲时按账号保存的官方地点安排出发。
- 实时展示步骤、账号进度、实际积分/能量和逐项结果，可折叠、停止后续任务。已发送的请求结束后停止，已完成结果保留。
- 最近一批记录保存在本机；异常退出标记为中断，再次运行先查询官方状态。损坏记录保留备份。
- 接取不代表完成。需要对话、指定模型、专家或客户端实际操作的任务显示「待完成」，当前不自动发送这些对话；只统计官方明确返回的奖励。
- 保留 WorkBuddy / Trae / Qoder 国内及国际版六个独立入口、菜单栏、底部状态栏、自动签到旅行、对话、用量及加密备份。

| 系统                      | 文件后缀                                                 |
| ------------------------- | -------------------------------------------------------- |
| Apple Silicon / Intel Mac | mac-arm64.dmg / mac-x64.dmg（另有 ZIP）                  |
| Windows 10/11 x64         | windows-x64-setup.exe / windows-x64-portable.exe         |
| Linux x64 / ARM64         | linux-x86_64.AppImage / linux-arm64.AppImage（另有 DEB） |

文件名前缀为 WorkBuddy-Switch-1.3.0-，发布页附 SHA256SUMS.txt。macOS 13+，采用 ad-hoc 签名、尚未 Apple 公证；Windows 尚未 Authenticode 签名。

Linux 需要图形桌面与已解锁的 GNOME Keyring 或 KWallet。厂商客户端是否提供对应系统/架构版本，以其官方发布为准。WorkBuddy 国际版不调用国内活动接口。

验证使用隔离账号、模拟官方响应、界面测试与各系统原生 Electron 启动；未操作用户真实账号执行任务或领取奖励。账号资格、接口与客户端格式以官方实际状态为准。

[一键任务与积分指南](https://github.com/koi128bit/WorkBuddy-Switch/wiki/签到与猫猫旅行) · [使用 Wiki](https://github.com/koi128bit/WorkBuddy-Switch/wiki)
