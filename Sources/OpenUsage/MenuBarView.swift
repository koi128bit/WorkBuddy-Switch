import AppKit
import SwiftUI

struct MenuBarView: View {
    @ObservedObject var state: AppState
    @ObservedObject private var accounts: AccountStore
    @Environment(\.openWindow) private var openWindow

    init(state: AppState) {
        self.state = state
        _accounts = ObservedObject(wrappedValue: state.accounts)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                AppIconView(size: 32)
                VStack(alignment: .leading, spacing: 2) {
                    Text("WorkBuddy Switch")
                        .font(.system(size: 14, weight: .semibold))
                    Text(
                        accounts.currentAccount?.nickname
                            ?? (accounts.currentUserID == nil ? "未连接 WorkBuddy" : "WorkBuddy 已登录")
                    )
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button {
                    Task { await state.refreshAll(force: true) }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.borderless)
                .help("刷新")
                .accessibilityLabel("刷新")
            }
            .padding(14)

            if let alert = state.alert {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(alert.title)
                            .font(.system(size: 11, weight: .semibold))
                        Text(alert.message)
                            .font(.system(size: 10))
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                    Spacer()
                    Button {
                        state.alert = nil
                    } label: {
                        Image(systemName: "xmark")
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("关闭错误")
                }
                .padding(10)
                .background(Color.orange.opacity(0.08))
                Divider()
            }

            Divider()

            HStack(spacing: 0) {
                menuMetric("Token", DisplayFormat.tokens(state.usage.total.total))
                Divider().frame(height: 38)
                menuMetric("Credits", DisplayFormat.credits(state.usage.credits))
                Divider().frame(height: 38)
                menuMetric("对话", state.usage.sessions.count.formatted())
            }
            .padding(.vertical, 12)

            if let quota = state.quota {
                VStack(alignment: .leading, spacing: 7) {
                    HStack {
                        Text(quota.packageName ?? "本周期额度")
                        Spacer()
                        Text(quota.usedFraction, format: .percent.precision(.fractionLength(0)))
                    }
                    .font(.system(size: 10, weight: .medium))
                    ProgressView(value: quota.usedFraction)
                        .tint(OpenUsageColors.blue)
                }
                .padding(.horizontal, 14)
                .padding(.bottom, 12)
            }

            Divider()

            if !accounts.accounts.isEmpty {
                Text("快速切换")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 14)
                    .padding(.top, 12)
                    .padding(.bottom, 5)

                ForEach(accounts.accounts.prefix(5)) { profile in
                    Button {
                        Task { await state.switchAccount(to: profile) }
                    } label: {
                        HStack {
                            Text(profile.initials)
                                .font(.system(size: 10, weight: .semibold))
                                .frame(width: 25, height: 25)
                                .background(Color.primary.opacity(0.06))
                                .clipShape(Circle())
                            Text(profile.nickname)
                                .font(.system(size: 11, weight: .medium))
                                .lineLimit(1)
                            Spacer()
                            if profile.id == accounts.currentUserID {
                                Image(systemName: "checkmark")
                                    .foregroundStyle(OpenUsageColors.blue)
                            }
                        }
                        .padding(.horizontal, 12)
                        .frame(height: 34)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(accounts.isSwitching || state.resumingSessionID != nil)
                }
                if accounts.accounts.count > 5 {
                    Button("全部账号…") {
                        state.selectedSection = .accounts
                        openMainWindow()
                    }
                    .buttonStyle(.borderless)
                    .font(.system(size: 10, weight: .medium))
                    .padding(.horizontal, 14)
                    .padding(.vertical, 6)
                }
                Divider()
            }

            let recent = state.sessions.filter {
                !$0.isDeleted && state.canResume($0)
            }.prefix(3)
            if !recent.isEmpty {
                Text("最近对话")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 14)
                    .padding(.top, 10)
                    .padding(.bottom, 4)
                ForEach(Array(recent)) { session in
                    Button {
                        Task { await state.resume(session) }
                    } label: {
                        HStack {
                            Image(systemName: "bubble.left")
                                .frame(width: 24)
                            Text(session.title)
                                .font(.system(size: 11, weight: .medium))
                                .lineLimit(1)
                            Spacer()
                            Image(
                                systemName: state.sessionNeedsMigration(session)
                                    ? "arrow.left.arrow.right"
                                    : "arrow.up.forward.app"
                            )
                                .foregroundStyle(.secondary)
                        }
                        .padding(.horizontal, 12)
                        .frame(height: 32)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .help(state.resumeActionTitle(session))
                }
                Divider()
            }

            HStack {
                Button("打开 WorkBuddy Switch") {
                    openMainWindow()
                }
                .buttonStyle(.borderless)
                Spacer()
                Button("退出") {
                    NSApplication.shared.terminate(nil)
                }
                .buttonStyle(.borderless)
            }
            .font(.system(size: 11, weight: .medium))
            .padding(12)
        }
        .frame(width: 318)
        .task { await state.start() }
    }

    private func openMainWindow() {
        openWindow(id: "main")
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    private func menuMetric(_ title: String, _ value: String) -> some View {
        VStack(spacing: 3) {
            Text(value)
                .font(.system(size: 15, weight: .semibold, design: .rounded))
                .lineLimit(1)
                .minimumScaleFactor(0.75)
            Text(title)
                .font(.system(size: 9))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}
