WorkBuddy Switch 1.8.0：Raycast Dark 工作台与真实数据图表。

- 统一重构总览、账号、积分、对话、用量、API、设置、弹窗和菜单栏面板，采用紧凑深色布局与细分隔线。
- 新增原生毛玻璃：macOS 模糊桌面背景，Windows 11 22H2+ 使用 Acrylic；可关闭并尊重系统减少透明度 / 高对比度设置，其他系统使用深色兼容外观。
- 新增总览：可用 / 临期积分、近 7 天 Token、账号余额分布、任务状态与本机服务。
- 新增交互折线图、Token 环图、模型对比、每日精确数据表，支持悬停和键盘聚焦。
- 奖励趋势按账号显示签到与旅行记录；API 分析展示 7 / 30 天请求量、Token、成功率、P50 / P95 延迟与模型调用分布。
- ⌘ / Ctrl + K 打开命令搜索，支持方向键选择、回车打开和 Esc 关闭。
- 无记录时显示空状态，未知积分 / Token 单独标记；API 图表仅覆盖保留的最近 100 条元数据。
- 保留原猫咪图标、六个客户端、任务与 API 功能、账号和密钥；Mac / Windows 沿用固定位置覆盖升级。

提供 Mac Apple Silicon / Intel、Windows x64、Linux x64 / ARM64 的 12 个安装包，附 SHA256SUMS.txt。

macOS 使用 ad-hoc 签名、未 Apple 公证，PKG 未签署 Developer ID Installer；Windows 尚未 Authenticode 签名。
