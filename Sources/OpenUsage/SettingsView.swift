import ServiceManagement
import SwiftUI

struct SettingsView: View {
    @ObservedObject var state: AppState
    @AppStorage("autoCaptureCurrentAccount") private var autoCapture = false
    @AppStorage("refreshIntervalMinutes") private var refreshInterval = 10
    @State private var launchAtLogin = SMAppService.mainApp.status == .enabled

    private var appVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
            ?? "Development"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                SectionTitle(title: "设置", subtitle: "WorkBuddy Switch \(appVersion)")

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
                    Toggle("启动时保存当前 WorkBuddy 账号", isOn: $autoCapture)
                    HStack {
                        Text("自动刷新")
                        Spacer()
                        Picker("自动刷新", selection: $refreshInterval) {
                            Text("5 分钟").tag(5)
                            Text("10 分钟").tag(10)
                            Text("30 分钟").tag(30)
                            Text("60 分钟").tag(60)
                        }
                        .labelsHidden()
                        .frame(width: 120)
                    }
                }

                settingsSection("数据源") {
                    statusRow(
                        title: "WorkBuddy",
                        detail: WorkBuddyController().applicationURL?.path ?? "未安装",
                        available: WorkBuddyController().applicationURL != nil
                    )
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

                settingsSection("隐私") {
                    Label("账号凭据存储在 macOS 钥匙串", systemImage: "lock.shield")
                    Label("Token 统计在本机解析，不上传对话内容", systemImage: "internaldrive")
                    Label("仅额度刷新访问 WorkBuddy 官方接口", systemImage: "network")
                }

                HStack {
                    Link(
                        "GitHub",
                        destination: URL(
                            string: "https://github.com/koi128bit/WorkBuddy-Switch"
                        )!
                    )
                    Spacer()
                    Text("非腾讯或 WorkBuddy 官方产品")
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
