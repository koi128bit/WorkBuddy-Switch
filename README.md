<div align="center">
  <img
    src="Sources/OpenUsage/Resources/AppIcon.png"
    width="120"
    height="120"
    alt="WorkBuddy Switch app icon"
  />

  <h1>WorkBuddy Switch</h1>

  <p>
    <strong>一个原生 macOS 应用，统一管理 WorkBuddy、Trae CN 与 TRAE Work。</strong>
    <br />
    三端账号一键切换 · WorkBuddy 跨账号续聊 · Token、Credits 与额度一屏看清。
  </p>

  <p>
    <a href="https://github.com/koi128bit/WorkBuddy-Switch/releases/tag/v0.2.0">
      <img
        src="https://img.shields.io/badge/下载-v0.2.0%20预发布版-2ea44f?style=for-the-badge&logo=apple"
        alt="下载 WorkBuddy Switch v0.2.0 预发布版"
      />
    </a>
  </p>

  <p>
    <a href="https://github.com/koi128bit/WorkBuddy-Switch/releases/tag/v0.2.0">
      <img
        src="https://img.shields.io/badge/pre--release-v0.2.0-0969da?style=flat-square"
        alt="Pre-release v0.2.0"
      />
    </a>
    <img
      src="https://img.shields.io/badge/macOS-13%2B-111111?style=flat-square&logo=apple"
      alt="macOS 13 or later"
    />
    <img
      src="https://img.shields.io/badge/Universal-Apple%20Silicon%20%7C%20Intel-555555?style=flat-square"
      alt="Apple Silicon and Intel"
    />
    <a href="LICENSE">
      <img
        src="https://img.shields.io/github/license/koi128bit/WorkBuddy-Switch?style=flat-square"
        alt="MIT License"
      />
    </a>
  </p>

  <p>
    <a href="#快速开始">快速开始</a>
    ·
    <a href="https://github.com/koi128bit/WorkBuddy-Switch/wiki">使用指南</a>
    ·
    <a href="#安全与隐私">安全与隐私</a>
    ·
    <a href="CHANGELOG.md">更新日志</a>
    ·
    <a href="https://github.com/koi128bit/WorkBuddy-Switch/issues">反馈问题</a>
  </p>
</div>

<p align="center">
  <img
    src=".github/assets/overview.jpeg"
    width="1120"
    alt="WorkBuddy Switch 总览：Token、Credits、对话、账号与周期额度"
  />
</p>

## 三个客户端，一个清晰入口

WorkBuddy、Trae CN 与 TRAE Work 各自维护登录状态和用量数据。需要在多个账号之间
工作时，反复退出登录会打断当前节奏，也很难快速确认每个账号还剩多少可用额度。

WorkBuddy Switch 用统一的提供方切换器把账号管理和用量视图放进一个原生 macOS
应用。WorkBuddy 还可以浏览本地历史对话，并把选中的跨账号会话安全迁移到当前账号
继续处理。

## 核心能力

<table>
  <tr>
    <th width="33%">统一账号快切</th>
    <th width="34%">WorkBuddy 继续对话</th>
    <th width="33%">用量与额度</th>
  </tr>
  <tr>
    <td>
      保存并切换 WorkBuddy、Trae CN 与 TRAE Work 账号。账号快照与凭据存入
      macOS Keychain。
    </td>
    <td>
      搜索、筛选和恢复 WorkBuddy 历史对话。跨账号继续时，只迁移选中的会话到
      当前账号，不切回原账号。
    </td>
    <td>
      查看 WorkBuddy 的本地 Token、Credits 与周期额度，并展示 Trae API 返回的
      用量或额度结果。
    </td>
  </tr>
</table>

> [!NOTE]
> 对话浏览与跨账号恢复仅支持 WorkBuddy；Trae CN 与 TRAE Work 当前支持账号切换和
> 官方 API 用量/额度。

- **WorkBuddy 今天优先**：默认展示当天数据，也可选择 7 天、30 天、全部或自定义
  日历区间。
- **15 秒自动刷新**：WorkBuddy 本地会话与用量、Trae API 用量每 15 秒轻量更新；
  额度数据的时效以服务端返回为准。
- **WorkBuddy 菜单栏入口**：不打开主窗口，也能查看摘要、刷新额度和快速切换账号。
- **非破坏式切换**：Trae 账号切换不会删除设置、插件/扩展、工作区或对话，也不会
  重置机器标识。
- **安全备份**：WorkBuddy 会话迁移前会创建一致性数据库备份，并保留最近 5 份。

<p align="center">
  <img
    src=".github/assets/usage-dashboard.png"
    width="1120"
    alt="WorkBuddy Switch 按模型筛选的 Token 与 Credits 用量面板"
  />
</p>

## 快速开始

> [!IMPORTANT]
> 需要 macOS 13 Ventura 或更高版本，以及至少一个受支持的桌面客户端：
> WorkBuddy、Trae CN 或 TRAE Work。
> 发布包为 Universal App，同时支持 Apple Silicon 和 Intel Mac。

1. 前往 [v0.2.0 预发布版](https://github.com/koi128bit/WorkBuddy-Switch/releases/tag/v0.2.0)。
2. 下载 `WorkBuddy-Switch-<version>-universal.dmg`。
3. 打开 DMG，将 `WorkBuddy Switch.app` 拖入 `Applications`。
4. 在目标客户端登录账号，然后在 WorkBuddy Switch 中选择对应提供方并保存当前账号。

> [!NOTE]
> 请以对应 Release 页面的签名与公证说明为准。如果下载的构建未经过 Apple 公证，
> macOS 可能要求你先在 Finder 中右键应用并选择“打开”。

保存第二个账号时，先在对应客户端中登录该账号，再回到 WorkBuddy Switch 保存当前
状态。之后即可在主窗口或菜单栏一键切换。

## WorkBuddy 跨账号续聊如何保证安全

当你在账号 B 登录状态下继续账号 A 的会话时，WorkBuddy Switch 会：

1. 确认当前 WorkBuddy 身份仍是账号 B。
2. 安全停止 WorkBuddy，并检查是否存在交互式 CLI 会话。
3. checkpoint SQLite WAL，并在 `~/.workbuddy/migrate_backups/` 创建完整备份。
4. 在受保护事务中，只把所选会话迁移到账号 B；其他会话保持不变。
5. 再次验证迁移结果，然后用当前账号 B 打开该对话。

**“迁移并继续”不会切换到对话原来的账号。** 如果迁移后的检查失败，应用会使用
迁移前备份自动恢复数据库；失败备份会保留，方便人工排查。

## 安全与隐私

| 数据 | 处理方式 |
|:---|:---|
| 账号凭据 | WorkBuddy、Trae CN 与 TRAE Work 的账号快照存入 macOS Keychain；敏感令牌不展示、不记录日志 |
| WorkBuddy 对话 | 只读取本机 `~/.workbuddy/workbuddy.db`；仅在恢复所选会话时写入 |
| WorkBuddy Token | 在本机流式解析 `~/.workbuddy/projects/**/*.jsonl`，不上传对话内容 |
| Trae 本地数据 | 账号切换不删除设置、插件/扩展、工作区或对话；不执行机器标识重置或状态清理 |
| 数据库备份 | WorkBuddy 会话迁移前使用 SQLite online backup；备份权限为 `0600`，最近保留 5 份 |
| 网络请求 | 用量或额度刷新会访问对应提供方接口，并使用当前登录账号的凭据 |

完整安全说明和漏洞报告方式见 [SECURITY.md](SECURITY.md)。

## 用量口径

<details>
<summary><strong>WorkBuddy Token 如何统计？</strong></summary>

每条 assistant 消息兼容读取 `providerData.rawUsage` 与 `providerData.usage`：

```text
净输入 = prompt - 缓存读取 - 缓存写入
输出   = completion
思考   = 输出的一部分，不重复计入总量
总量   = 净输入 + 缓存读取 + 缓存写入 + 输出
       = prompt + completion
```

会话 ID 通过 SQLite `sessions.user_id` 映射到账号。重复文件优先使用消息 ID 去重；
缺少消息 ID 时使用稳定内容哈希，避免恢复或复制记录后重复计数。

</details>

<details>
<summary><strong>为什么模型 Credits 可能低于 WorkBuddy 显示的周期消耗？</strong></summary>

WorkBuddy 的额度接口只返回当前账号的周期总额，不提供模型级账单。模型 Credits
只统计本地日志中带 `usage` 的记录，因此 Kimi K3 等模型的本地可归因值可能低于
实际消耗。

界面会把“服务端周期已用”“本地可归因”和“未归因”分开显示，不会根据 Token
数量猜测 Credits。

</details>

<details>
<summary><strong>Trae 用量如何统计？</strong></summary>

Trae CN 与 TRAE Work 的用量视图展示 Trae API 为当前账号返回的结果。应用以 15 秒为
刷新目标，但数据字段、统计周期和更新时效以 Trae 服务实际响应为准；WorkBuddy
本地 Token 的计算公式不适用于 Trae。

</details>

## 兼容性

| 项目 | 支持情况 |
|:---|:---|
| macOS | 13 Ventura 或更高版本 |
| Mac 芯片 | Apple Silicon 与 Intel |
| WorkBuddy | macOS 桌面版；当前在 5.3.3 上验证 |
| Trae CN | 账号切换与 Trae API 用量/额度视图；不支持对话浏览或恢复 |
| TRAE Work | 账号切换与 Trae API 用量/额度视图；不支持对话浏览或恢复 |
| 界面语言 | 简体中文 |
| 刷新频率 | 本地会话/用量与 Trae API 用量每 15 秒自动更新；额度时效以服务端返回为准 |

客户端本地格式和远程接口可能随版本变化。如果升级后出现账号或用量问题，请附上
客户端名称与版本号提交 [Issue](https://github.com/koi128bit/WorkBuddy-Switch/issues/new)；
不要上传凭据、数据库或包含对话内容的日志文件。

## 本地构建

需要 Apple Command Line Tools 和 Swift 5.10+：

```bash
git clone https://github.com/koi128bit/WorkBuddy-Switch.git
cd WorkBuddy-Switch
scripts/test.sh
scripts/build-release.sh
```

产物位于 `dist/`。构建 Universal 包：

```bash
OPENUSAGE_ARCHS="arm64 x86_64" scripts/build-release.sh
```

Developer ID 签名与公证：

```bash
OPENUSAGE_SIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)" \
OPENUSAGE_NOTARY_PROFILE="notary-profile" \
OPENUSAGE_ARCHS="arm64 x86_64" \
scripts/build-release.sh
```

## 常见问题

<details>
<summary><strong>点击继续对话时，会切换到原账号吗？</strong></summary>

不会。此功能仅适用于 WorkBuddy，当前账号就是目标账号。不同账号的会话会先迁移
所选记录，再在当前账号中打开。

</details>

<details>
<summary><strong>会修改所有旧账号的对话吗？</strong></summary>

不会。WorkBuddy 迁移使用会话 ID 和预期源账号双重条件，只更新你选中的一条记录。

</details>

<details>
<summary><strong>数据库损坏了怎么办？</strong></summary>

迁移前必须成功创建 SQLite 备份，否则不会执行写入。迁移后的验证失败时会自动回滚。
备份位于 `~/.workbuddy/migrate_backups/`。

</details>

<details>
<summary><strong>Trae 可以浏览或继续历史对话吗？</strong></summary>

暂不支持。Trae CN 与 TRAE Work 当前只提供账号切换和用量/额度视图；对话浏览与
跨账号恢复仅支持 WorkBuddy。

</details>

<details>
<summary><strong>切换 Trae 账号会删除设置、插件或对话吗？</strong></summary>

不会。切换过程不删除 Trae 设置、插件/扩展、工作区或对话，也不重置机器标识。

</details>

<details>
<summary><strong>为什么 macOS 提示无法验证开发者？</strong></summary>

请先核对对应 Release 页面的签名与公证说明，并确认文件来自本仓库。如果该构建未
经过 Apple 公证，可以在 Finder 中右键应用并选择“打开”。

</details>

## 反馈与贡献

- 使用指南：[项目 Wiki](https://github.com/koi128bit/WorkBuddy-Switch/wiki)
- Bug 或功能建议：[GitHub Issues](https://github.com/koi128bit/WorkBuddy-Switch/issues)
- 版本变化：[CHANGELOG.md](CHANGELOG.md)
- 安全问题：[SECURITY.md](SECURITY.md)
- 参考项目与固定修订：[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

欢迎提交 Issue 和 Pull Request。涉及客户端状态或本地格式的报告请先脱敏，不要提交
access token、refresh token、账号快照、数据库或原始对话日志。

## 致谢与许可

WorkBuddy Switch 参考了
[workbuddy-account-migrate](https://github.com/xiaoliuzhuan666/workbuddy-account-migrate)、
[usageBar](https://github.com/ChanningYuan/usageBar)、
[Trae-cc](https://github.com/HHH9201/Trae-cc)、
[CC Switch](https://github.com/farion1231/cc-switch) 的兼容数据格式与交互思路。
具体修订和许可证信息见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

本项目以 [MIT License](LICENSE) 发布。

WorkBuddy Switch 是独立开源项目，与 WorkBuddy、Trae、Kimi 及上述开源项目无隶属、
认可或赞助关系；相关名称和商标归各自权利人所有。

<div align="center">
  <strong>如果它解决了你的问题，欢迎点一个 Star，让更多需要多账号切换的用户找到它。</strong>
</div>
