WorkBuddy Switch 1.5.0：新版覆盖旧版，沿用账号和设置。

- **Mac 推荐 PKG**：固定替换 `/Applications/WorkBuddy Switch.app`，安装前要求退出旧版；移除旧应用包内过时文件，保留用户数据。
- **DMG / 临时副本**：启动时提供安装并替换；检测到已安装更新版本时打开已安装版，避免直接降级。
- **Windows setup.exe**：固定原安装 GUID、程序名、快捷方式和卸载入口，自动复用旧安装位置。便携版仍需自行覆盖原可执行文件。
- **退出与构建**：等待当前操作结束再退出；Mac 构建副本放入隐藏目录，公开输出只包含最终安装包。
- 保留原猫咪图标、简约界面，以及一键做任务、账号切换、菜单栏和状态栏等功能。

提供 Apple Silicon / Intel 的 PKG、DMG、ZIP，Windows x64 安装版与便携版，以及 Linux x64 / ARM64 AppImage / DEB，共 12 个安装包；发布页附 SHA256SUMS.txt。

升级前请完成或停止正在执行的任务。已有多个副本时，安装后从「应用程序」打开，并推出旧版 DMG；历史下载文件不会自动删除。

macOS 应用使用 ad-hoc 签名，PKG 尚未签署 Developer ID Installer、尚未 Apple 公证；Windows 尚未 Authenticode 签名。安装系统可能需要你允许打开或输入管理员密码。

[安装与升级指南](https://github.com/koi128bit/WorkBuddy-Switch/wiki/安装与首次启动)
