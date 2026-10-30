WorkBuddy Switch 2.0.0：本机 API 可以只对你自己的局域网开放，更新也能在应用里一次做完。

**本机 API 支持局域网访问（可选，默认关闭）**

- API 页「账号与调度」新增 **允许局域网访问** 开关。关闭时和以前一样只监听 `127.0.0.1`；打开并重启服务后改绑 `0.0.0.0`，同一网段的手机、另一台电脑，或本机的容器 / 虚拟机就能直接调用 `http://<局域网 IP>:8317/v1`，页面会显示并支持一键复制局域网地址。
- `Host` 白名单随开关放宽：始终接受 `127.0.0.1`、`localhost`、`[::1]`；开启后额外接受本机各网卡 IP、主机名与 `*.local`。其它 Host 仍返回 `403 local_clients_only`。
- 安全边界不变：API Key 校验照旧，带 `Origin` 或 `Sec-Fetch-Site: cross-site` 的浏览器请求一律拒绝。局域网模式是给工具和容器用的，不会把服务变成网页可直连的入口。
- 配置文件缺少 `lan` 字段时按关闭处理，1.9.x 的设置不用迁移。

**应用内完成更新全流程**

- 「设置 → 关于与更新」现在是完整更新面板：检查更新 → 下载 → 校验 → 安装 → 重启，全程不用离开应用，也不用自己去 Releases 找安装包。
- 国内网络可用：默认 `auto` 线路按 `gh-proxy.com` → `ghproxy.net` → `ghfast.top` → 直连顺序回退，单个源 9 秒超时，直连放最后。直连 GitHub 不通时也能在几秒内拿到版本信息和安装包；线路可在页面切换，也能填写自定义镜像。
- 下载流式落盘到应用数据目录的 `updates/`，边下边算 SHA-256，与官方 `SHA256SUMS.txt` 比对一致才允许安装；校验不一致会删掉半成品并提示重试。界面显示进度、已收字节与总大小。
- 安装按平台分发：macOS 走 `installer`（管理员授权）或挂载 DMG / 解压 ZIP 后替换 `.app`；Windows 静默安装或覆盖便携版；Linux 原地替换 AppImage（失败回退 `pkexec`）或 `pkexec dpkg -i`。安装前自动停止本机 API 服务并退出，装完自动重新启动；失败保留日志与文件，页面可打开下载目录查看。
- 新增两个设置项：`updateMirror`（默认 `auto`）与 `autoCheckUpdate`（默认开）。自动检查只在打包后的应用启动 6 秒后触发，失败只写操作日志。

**验证**

- 新增 `tests/api-lan.test.mjs`（5 项）、`tests/updater.test.mjs`（22 项）、`tests/update-installer.test.mjs`（14 项）；`npm test` 共 365 项通过，`test:desktop` 365 项通过，Playwright 40 项通过。
- 在强制直连（不使用系统代理）的 Electron 环境里实测：检查更新 2.4 秒走 `gh-proxy.com` 拿到 13 个资产并选中 `mac-arm64.pkg`；下载 133.8 MB 用 12 秒，SHA-256 与官方 `SHA256SUMS.txt` 一致。

提供 Mac Apple Silicon / Intel、Windows x64、Linux x64 / ARM64 安装包，附 SHA256SUMS.txt。已安装 1.9.x 的用户可以直接在应用内更新到本版。
