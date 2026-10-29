WorkBuddy Switch 1.9.6：正式启用新增原创内容的强制署名许可，并调整本机 API 兼容处理。

- 新增原创内容采用 WorkBuddy Switch Attribution License 1.0。对外分发、衍生应用或使用其提供服务时，须保留项目名 WorkBuddy Switch、原作者 koi128bit、可点击的原仓库链接及适用的「关于 / 致谢」署名。允许商业使用和闭源衍生分发，不要求公开源码。
- 1.9.5 及以前版本与提交 bfa9b64 及以前已按 MIT 提供的内容继续保留原授权；第三方许可不变。独立实现同类功能不因功能相似受此许可约束。全文见随包 LICENSE，历史与上游声明见 LICENSES/MIT-legacy.txt、NOTICE 和 THIRD_PARTY_NOTICES.md。
- README、应用「关于与更新」、系统关于面板和包许可字段同步更新，应用提供固定版本的许可全文与上游声明入口。
- 本机 API 将 system / developer 文本合并到首条 user 消息，保留其文本、工具定义与其余历史；移除零宽分隔符和身份句改写，systemGuard 保留为 0。此处理会改变角色及指令优先级，不保证与原请求语义等价。
- 官方明确返回 11128 且尚未产生任何输出时，最多改用账号池中的其他账号重试 3 次；已输出、权限、账号限制、上下文或工具记录错误不重发。实际可用性、限流、权限与计费以官方为准。
- macOS 自构建可显式启用 WORKBUDDY_LOCAL_VAULT=1，使用随机密钥和 nonce 的 AES-256-GCM。原系统记录通过真实系统密钥环读取，保留已有本地密钥，损坏或缺失时停止操作；正式包仍默认使用 safeStorage，ASAR 完整性验证保持开启。

提供 Mac Apple Silicon / Intel、Windows x64、Linux x64 / ARM64 安装包，附 SHA256SUMS.txt。

macOS 使用 ad-hoc 签名，未做 Apple 公证；Windows 尚未做 Authenticode 签名。

许可全文：https://github.com/koi128bit/WorkBuddy-Switch/blob/v1.9.6/LICENSE
原项目：https://github.com/koi128bit/WorkBuddy-Switch
