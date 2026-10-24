<div align="center">
  <img src="assets/icon.png" width="96" height="96" alt="WorkBuddy Switch 原猫咪图标" />
  <h1>WorkBuddy Switch</h1>
  <p>管理 WorkBuddy、Trae 与 Qoder 的国内和国际版，支持 macOS、Windows 与 Linux。<br />一键领积分 · 猫猫旅行 · 安全切换 · 对话续接</p>
  <p>
    <a href="https://github.com/koi128bit/WorkBuddy-Switch/releases/latest">下载应用</a> ·
    <a href="https://github.com/koi128bit/WorkBuddy-Switch/wiki">使用指南</a> ·
    <a href="CHANGELOG.md">更新日志</a> ·
    <a href="https://github.com/koi128bit/WorkBuddy-Switch/issues">反馈问题</a>
  </p>
  <p>
    <img src="https://img.shields.io/badge/macOS-13%2B-444444?style=flat-square&logo=apple" alt="macOS 13+" />
    <img src="https://img.shields.io/badge/Windows-10%2F11%20x64-444444?style=flat-square" alt="Windows 10/11 x64" />
    <a href="LICENSE"><img src="https://img.shields.io/github/license/koi128bit/WorkBuddy-Switch?style=flat-square&color=444444" alt="MIT License" /></a>
  </p>
</div>

<p align="center"><img src=".github/assets/dark.png" width="1120" alt="原生灰阶深色界面：账号列表、积分、签到、旅行与状态栏" /></p>

WorkBuddy Switch 1.2 在同一个简洁灰阶界面中管理 WorkBuddy、Trae 和 Qoder，提供六个独立客户端入口。客户端各自保留独立账号列表，支持浅色、深色、跟随系统和紧凑布局；原来的猫咪图标继续保留。主窗口和菜单栏都可以选择客户端，底部状态栏随所选客户端更新。

> 截图均为演示账号和模拟数据。真实积分、任务资格与奖励以官方接口为准，本地用量来自设备上的记录。

## 支持的客户端

| 客户端            | 账号功能                                                   | 其他功能                                               |
| ----------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| WorkBuddy 国内版  | 保存当前登录、官方网页登录、刷新授权、切换、跨设备加密备份 | 官方积分、一键签到与旅行领奖、自动任务、本地对话与用量 |
| WorkBuddy 国际版  | 独立账号库与官方授权、切换、积分查询、跨设备加密备份       | 独立本地对话与用量；活动不调用国内版接口               |
| Trae CN / 国际版  | 真实 UID 识别、官方网页登录、授权续期、完整登录快照切换    | 备注、收藏、搜索、托盘切换、切换失败恢复               |
| Qoder CN / 国际版 | 真实 UID 识别、官方网页登录、授权续期、完整登录快照切换    | 备注、收藏、搜索、托盘切换、切换失败恢复               |

产品、地区和本机操作系统分别适配，账号库、授权域名、应用标识及数据目录隔离。当前支持桌面客户端；Qoder IDE 插件、独立 CLI、Trae SOLO 使用不同的程序和登录目录，不共用桌面快照。

Trae / Qoder 网页授权与客户端登录资料分别加密保存，用同地区真实 UID 关联。**网页登录不会直接替换桌面登录。** 首次切换前，在官方客户端登录该账号并点击「保存当前账号」一次。未关联完整客户端资料的账号会显示待关联，并禁用切换，避免拼接另一账号的资料导致退登。

客户端格式暂不能识别时，可保留兼容快照；此时不把手填名称当成已验证身份。恢复成功只代表本机登录文件检查通过，最终登录状态由官方客户端与服务器确认。

## WorkBuddy 功能

| 页面     | 功能                                                                                 |
| -------- | ------------------------------------------------------------------------------------ |
| **账号** | 官方网页登录添加、保存当前登录、搜索、收藏、备注、排序、多选领取、安全切换和加密备份 |
| **积分** | 每日签到、猫猫旅行、出发与领奖、按账号配置自动任务、查看领取结果和失败原因           |
| **对话** | 搜索本地记录、按账号筛选、恢复回收站对话、迁移到当前账号继续                         |
| **用量** | Token 分项、模型与对话排行、日期范围、日志 Credits 与 CSV 导出                       |
| **设置** | 常规、自动任务、外观与隐私、连接与路径、数据与备份、关于与更新                       |

WorkBuddy 账号页提供「需关注」筛选，集中显示查询失败、凭据待续期、低余额与临期积分。积分包明细展示各包可用量和到期时间；「建议先用」仅依据最近 6 小时内查询成功的临期积分，不会自动切换账号。

底部状态栏显示当前客户端的运行状态、自动任务开关、正在执行的操作和积分刷新时间，并提供保存当前账号与隐私遮罩快捷操作。

## Trae 与 Qoder 账号

<p align="center"><img src=".github/assets/trae-cn.png" width="1120" alt="Trae CN 本机登录快照，演示账号" /></p>

1. 在侧栏的「客户端」选择 对应产品的国内版或国际版。
2. 在对应官方客户端登录账号 A，回到本应用点击 **保存当前账号**，填写容易辨认的名称；应用会尝试识别真实 UID。
3. 在官方客户端登录账号 B 后再次保存。之后在列表或菜单栏选择目标账号，确认切换。
4. 自定义安装位置可在账号页的 **路径配置**，或「设置 → 连接与路径」中指定。Windows 的 Qoder CN 支持读取官方启动器位置。

切换前正常退出目标客户端、保存切换前的登录快照，再恢复目标登录。只处理明确的登录字段或登录文件，保留设置、插件、工作区、对话、机器标识与其他客户端的状态。失败时尝试恢复原登录；中断后的加密恢复记录可通过 **恢复切换前登录** 处理。检测到后续新登录时，会停止恢复以保护新登录；此时可选择「保留当前登录并归档」，保存当前快照并归档旧恢复记录，再继续切换。

产品和地区分别校验。客户端升级导致格式变化时请重新保存快照。本机只读核验过 Trae CN 3.4.4 的公开格式，未使用真实账号执行切换，也未安装 Qoder CN；测试使用隔离文件、模拟接口和原生主机。

## 一键领积分与猫猫旅行

<p align="center"><img src=".github/assets/rewards.png" width="1120" alt="签到与猫猫旅行：官方状态、出发、领奖、账号自动任务与领取记录" /></p>

- **一键领取**：在账号列表勾选账号，点击「一键领积分」。先查询官方状态，再完成未签到账号的每日签到，并领取已经到达的旅行奖励。账号详情和菜单栏也提供快捷领取。
- **旅行出发**：在积分页选择官方提供的地点，点击「出发」。旅行中、已到达和今日次数已用完分别展示；到达前不会按本地倒计时提前领奖。
- **自动任务**：在「设置 → 自动任务」分别开启自动签到、旅行领奖和旅行出发，设置签到时间与检查间隔。各账号可单独退出自动任务；自动出发需要预先选择地点。
- **领取记录**：保存本应用执行的签到、旅行和出发结果。官方未返回奖励金额时显示「未返回金额」，不推测或补造积分；失败不会计入成功领取。

签到与旅行目前适用于国内版账号，并受官方活动开放情况和账号资格限制。自动任务默认关闭，只有应用运行且电脑未休眠时才执行；关闭到菜单栏或托盘后可继续运行，完全退出后停止。签到时间按北京时间计算，到达设置时间后在下一次检查中执行。

在 Trae / Qoder 账号行点击「续期」可更新已识别的授权；这不会将网页 token 拼接到另一个人的客户端资料。要更新桌面快照，请在客户端正常登录后重新保存。

## 菜单栏与系统托盘

<p align="center"><img src=".github/assets/tray.png" width="346" alt="菜单栏快捷面板：账号积分、切换、一键领取、主界面与设置" /></p>

点击猫咪图标，先选择客户端，即可查看其最近使用的账号、切换账号，或打开主界面与设置。WorkBuddy 还可查看缓存积分及一键领取。macOS 可在菜单栏图标旁显示当前账号的积分数字；Windows 和 Linux 使用系统托盘。隐私遮罩默认隐藏面板中的账号昵称，截图展示的是关闭昵称遮罩后的演示效果。

快捷键：`⌘ / Ctrl + ,` 打开设置，`⌘ / Ctrl + 1` 显示主窗口，`⌘ / Ctrl + Shift + M` 打开快捷面板。

## 下载与安装

从 [GitHub Releases](https://github.com/koi128bit/WorkBuddy-Switch/releases/latest) 下载，校验清单为同页的 `SHA256SUMS.txt`。

| 系统              | 1.2.0 安装包                                                                                                                                                                                                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Apple Silicon Mac | [mac-arm64.dmg](https://github.com/koi128bit/WorkBuddy-Switch/releases/download/v1.2.0/WorkBuddy-Switch-1.2.0-mac-arm64.dmg)                                                                                                                                                            |
| Intel Mac         | [mac-x64.dmg](https://github.com/koi128bit/WorkBuddy-Switch/releases/download/v1.2.0/WorkBuddy-Switch-1.2.0-mac-x64.dmg)                                                                                                                                                                |
| Windows 10/11 x64 | [安装版 setup.exe](https://github.com/koi128bit/WorkBuddy-Switch/releases/download/v1.2.0/WorkBuddy-Switch-1.2.0-windows-x64-setup.exe) · [便携版 portable.exe](https://github.com/koi128bit/WorkBuddy-Switch/releases/download/v1.2.0/WorkBuddy-Switch-1.2.0-windows-x64-portable.exe) |

| Linux x64 | [AppImage](https://github.com/koi128bit/WorkBuddy-Switch/releases/download/v1.2.0/WorkBuddy-Switch-1.2.0-linux-x64.AppImage) · [DEB](https://github.com/koi128bit/WorkBuddy-Switch/releases/download/v1.2.0/WorkBuddy-Switch-1.2.0-linux-x64.deb) |
| Linux ARM64 | [AppImage](https://github.com/koi128bit/WorkBuddy-Switch/releases/download/v1.2.0/WorkBuddy-Switch-1.2.0-linux-arm64.AppImage) · [DEB](https://github.com/koi128bit/WorkBuddy-Switch/releases/download/v1.2.0/WorkBuddy-Switch-1.2.0-linux-arm64.deb) |

Linux 需要桌面图形环境及已解锁的系统密钥环；AppImage 需要执行权限和对应系统的 FUSE 支持。WorkBuddy 国内版 Linux 由 UOS / 麒麟商店提供，其他客户端也以厂商当前发布的系统与架构版本为前提。自动发现失败时可手动选择应用及数据根目录。

macOS 打开 DMG，把 `WorkBuddy Switch.app` 拖到「应用程序」。Windows 运行安装程序选择安装位置，或直接运行便携版；便携版的应用数据仍保存在当前系统用户的数据目录。

macOS 包使用 ad-hoc 签名，尚未做 Apple 公证；Windows 包尚未做 Authenticode 签名。首次打开可能提示未知发布者，处理方式见 [安装指南](https://github.com/koi128bit/WorkBuddy-Switch/wiki/安装与首次启动)。

### 第一个账号

1. 安装并登录 WorkBuddy 桌面客户端。
2. 打开 WorkBuddy Switch，点击底部状态栏的 **保存当前账号**。
3. 需要查询或领取积分时，点击账号页的 **添加账号**，在官方网页授权同一账号。
4. 点击 **刷新**，查询积分、签到与旅行状态。添加更多账号后，可多选领取或点击 **切换**。

切换前会确认并正常关闭 WorkBuddy，请先结束正在运行的任务。官方网页登录添加账号不会改变客户端的当前登录身份。

WorkBuddy 5.6 的部分凭据采用本机加密封装。应用原样保留该封装用于本机切换，不提取客户端内置密钥；官方网页登录授权用于积分、活动和密码加密的跨设备备份。

从 0.x 升级的 macOS 用户，可在「设置 → 数据与备份」点击 **迁入旧版 macOS 账号**。原文件与钥匙串条目会保留。详见 [账号指南](https://github.com/koi128bit/WorkBuddy-Switch/wiki/账号保存与快速切换)。

## 对话续接与备份

跨账号继续或恢复回收站对话时，应用会先正常退出 WorkBuddy，创建包含 WAL 的完整 SQLite 备份，然后在事务中只修改选中记录的归属与删除标记。检查通过后使用当前账号打开对话。国际版暂不调用未经确认的对话深链接，恢复后在客户端对话列表继续。

这是**本地对话归属迁移**：原账号不再拥有这条本地记录，不会生成副本，也不同步云端权限。项目目录与依赖仍需在本机可用。备份在应用数据目录的 `session-backups/`，默认保留最近 10 份，可在设置中调整。

客户端退出失败、交互式 CLI 尚在运行或记录状态已变化时，会停止写入。账号切换后启动失败会尝试恢复原登录；对话写入检查失败只撤销本次记录修改。详见 [对话指南](https://github.com/koi128bit/WorkBuddy-Switch/wiki/恢复与跨账号继续对话)。

## 用量口径

<p align="center"><img src=".github/assets/analytics.png" width="1120" alt="Token 分项、模型用量、趋势与本地对话排行" /></p>

- **官方积分**：优先读取精确小数字段，排除已到期积分包，显示最近有效到期时间。查询失败明确提示，缓存不会冒充新结果。
- **本地 Token**：读取 `~/.workbuddy/projects/**/*.jsonl` 中 assistant 消息与工具调用的 usage，按记录 ID 去重。不同请求共用 trace ID 时仍分别计数，避免漏掉工具调用消耗。
- **记录 Credits**：只统计日志明确记录的积分，不按 Token 换算费用。它可能低于官方消耗，缺失记录时也可能为零。
- **时间与归属**：默认最近 7 天，可选择今天、30 天、全部或自定义日期；按本机时区和数据库中当前会话归属统计。迁移过的对话不会追溯原付费账号，无归属日志只计入「全部账号」。

```text
总 Token = 净输入 + 缓存读取 + 缓存写入 + 输出
         = prompt + completion
推理 Token 属于输出，不重复加入总量。
```

本地数据每 15 秒读取，官方积分默认每 5 分钟刷新，可关闭。详见 [Tokens、Credits 与额度](https://github.com/koi128bit/WorkBuddy-Switch/wiki/Tokens、Credits-与额度)。

## 设置与隐私

<p align="center"><img src=".github/assets/dark-settings.png" width="1120" alt="统一原生风格的设置页：主题、紧凑布局和隐私遮罩" /></p>

账号库使用系统 `safeStorage` 加密：macOS 由钥匙串保护，Windows 使用 DPAPI，Linux 使用 GNOME Keyring 或 KWallet。Linux 不接受 `basic_text` 降级，密钥环未解锁时拒绝保存和切换。Token 不传给界面，不写入操作日志。跨设备备份使用密码派生密钥与 AES-256-GCM；本机封装凭据需先通过官方网页登录重新授权，才能导出可移植备份。

对话与用量在本机处理，应用没有遥测、广告或第三方账号上传服务。网络仅用于官方登录、授权续期、积分与活动，以及手动检查本仓库 Releases。领取历史只记录账号、任务、结果、金额和时间。

隐私遮罩默认开启，会遮罩账号 ID、缩短工作目录，并隐藏菜单栏与通知里的昵称；主窗口中的账号名称和对话标题仍显示。详见 [SECURITY.md](SECURITY.md) 和 [隐私指南](https://github.com/koi128bit/WorkBuddy-Switch/wiki/数据、备份与隐私)。

## 本地开发

需要 Node.js **22.16+**，调试客户端功能需要安装相应客户端。测试使用独立目录和模拟凭据。

```bash
npm ci
npm run dev

npm test                 # 账号、签到、旅行、备份、用量和数据库
npm run test:desktop     # Electron 自带 Node 的后端兼容性
npm run build            # TypeScript 检查与界面构建
npm run test:smoke       # 主窗口、快捷面板、IPC、系统加密和设置
npx playwright install chromium
npm run test:ui          # 五页面交互、奖励、多选、主题与最小窗口

npm run dist:mac         # macOS 上构建 arm64 / x64 DMG 与 ZIP
npm run dist:win         # Windows 上构建 x64 安装版与便携版
npm run dist:linux       # Linux 上构建当前架构 AppImage 与 DEB
```

[GitHub Actions](https://github.com/koi128bit/WorkBuddy-Switch/actions/workflows/desktop.yml) 在macOS、Windows、Linux x64 与 Linux ARM64 四个原生 runner 上测试并打包，版本标签发布 Release 和 SHA-256 清单。项目结构见 [本地构建与贡献](https://github.com/koi128bit/WorkBuddy-Switch/wiki/本地构建与贡献)，界面与功能验收见 [design-qa.md](design-qa.md)。

## 许可

[MIT](LICENSE)。依赖许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。本项目是独立社区工具，与 WorkBuddy、Trae 或 Qoder 官方没有隶属关系。
