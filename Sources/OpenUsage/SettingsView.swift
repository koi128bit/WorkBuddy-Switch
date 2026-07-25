import ServiceManagement
import SwiftUI

struct SettingsView: View {
    @ObservedObject var state: AppState
    @ObservedObject private var traeAccounts: TraeAccountStore
    @AppStorage("autoCaptureCurrentAccount") private var autoCapture = false
    @AppStorage("refreshIntervalMinutes") private var refreshInterval = 10
    @State private var launchAtLogin = SMAppService.mainApp.status == .enabled

    init(state: AppState) {
        self.state = state
        _traeAccounts = ObservedObject(wrappedValue: state.traeAccounts)
    }

    private var appVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
            ?? "Development"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                SectionTitle(
                    title: "设置",
                    subtitle: "WorkBuddy Switch \(appVersion) · \(state.selectedProvider.title)"
                )

                settingsSection("常规") {
                    Toggle("登录时启动 WorkBuddy Switch", isOn: $launchAtLogin)
                        .onChange(of: launchAtLogin) { enabled in
                            do {
                                if enabled {
                                    try SMAppService.mainApp.register()
                                } else {
                                    try SMAppService.mainApp.unregister()
                                }
                            } catch {
                                launchAtLogin = SMAppService.mainApp.status == .enabled
                                state.present(error, title: "登录项设置失败")
                            }
                        }
                    Toggle(
                        "启动时保存当前 \(state.selectedProvider.title) 账号",
                        isOn: $autoCapture
                    )
                    HStack {
                        Text("完整刷新间隔")
                        Spacer()
                        Picker("完整刷新间隔", selection: $refreshInterval) {
                            Text("5 分钟").tag(5)
                            Text("10 分钟").tag(10)
                            Text("30 分钟").tag(30)
                            Text("60 分钟").tag(60)
                        }
                        .labelsHidden()
                        .frame(width: 120)
                    }
                }

                settingsSection("客户端与安装路径") {
                    statusRow(
                        title: "WorkBuddy",
                        detail: workBuddyApplicationURL?.path ?? "未安装",
                        available: workBuddyApplicationURL != nil
                    )
                    statusRow(
                        title: "Trae CN",
                        detail: traeApplicationURL(.china)?.path ?? "未安装",
                        available: traeApplicationURL(.china) != nil
                    )
                    statusRow(
                        title: "TRAE Work",
                        detail: traeApplicationURL(.work)?.path ?? "未安装",
                        available: traeApplicationURL(.work) != nil
                    )
                }

                settingsSection("\(state.selectedProvider.title) 数据源") {
                    if let variant = state.selectedTraeVariant {
                        let storageURL = TraeDataLocation.resolve(variant).storageURL
                        statusRow(
                            title: "登录数据",
                            detail: storageURL.path,
                            available: FileManager.default.fileExists(
                                atPath: storageURL.path
                            )
                        )
                        Label(
                            "Token 与额度来自 \(variant.displayName) 官方 API",
                            systemImage: "network"
                        )
                    } else {
                        statusRow(
                            title: "会话数据库",
                            detail: AppPaths.workBuddyDatabase.path,
                            available: FileManager.default.fileExists(
                                atPath: AppPaths.workBuddyDatabase.path
                            )
                        )
                        statusRow(
                            title: "Token 记录",
                            detail: AppPaths.workBuddyProjects.path,
                            available: FileManager.default.fileExists(
                                atPath: AppPaths.workBuddyProjects.path
                            )
                        )
                    }
                }

                settingsSection("隐私") {
                    Label(
                        "三个客户端的账号快照均存储在 macOS 钥匙串",
                        systemImage: "lock.shield"
                    )
                    Label(
                        "WorkBuddy Token 在本机解析；Trae 用量读取官方 API",
                        systemImage: "internaldrive"
                    )
                    Label(
                        "Trae 切号不会删除设置、插件、工作区或对话",
                        systemImage: "checkmark.shield"
                    )
                }

                HStack {
                    Link(
                        "GitHub",
                        destination: URL(
                            string: "https://github.com/koi128bit/WorkBuddy-Switch"
                        )!
                    )
                    Spacer()
                    Text("非 WorkBuddy 或 Trae 官方产品")
                        .font(.system(size: 10))
                        .foregroundStyle(.tertiary)
                }
            }
            .padding(28)
        }
        .onAppear {
            launchAtLogin = SMAppService.mainApp.status == .enabled
        }
        .alert(item: $state.alert) { alert in
            Alert(
                title: Text(alert.title),
                message: Text(alert.message),
                dismissButton: .default(Text("好"))
            )
        }
    }

    private var workBuddyApplicationURL: URL? {
        WorkBuddyController().applicationURL
    }

    private func traeApplicationURL(_ variant: TraeVariant) -> URL? {
        traeAccounts.applicationURL(for: variant)
    }

    private func settingsSection<Content: View>(
        _ title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 13) {
                content()
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(nsColor: .controlBackgroundColor))
            .overlay {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(OpenUsageColors.separator, lineWidth: 1)
            }
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
    }

    private func statusRow(title: String, detail: String, available: Bool) -> some View {
        HStack(spacing: 10) {
            Circle()
                .fill(available ? Color.green : Color.orange)
                .frame(width: 7, height: 7)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 12, weight: .semibold))
                Text(detail)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(title)，\(available ? "可用" : "不可用")，\(detail)")
    }
}
