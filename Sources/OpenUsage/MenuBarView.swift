import AppKit
import SwiftUI

struct MenuBarView: View {
    @ObservedObject var state: AppState
    @ObservedObject private var accounts: AccountStore
    @ObservedObject private var traeAccounts: TraeAccountStore
    @Environment(\.openWindow) private var openWindow

    init(state: AppState) {
        self.state = state
        _accounts = ObservedObject(wrappedValue: state.accounts)
        _traeAccounts = ObservedObject(wrappedValue: state.traeAccounts)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                AppIconView(size: 32)
                VStack(alignment: .leading, spacing: 2) {
                    Text("WorkBuddy Switch")
                        .font(.system(size: 14, weight: .semibold))
                    Text(currentAccountSubtitle)
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
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

            ProviderSwitcherView(
                selection: Binding(
                    get: { state.selectedProvider },
                    set: { provider in
                        state.selectProvider(provider)
                    }
                )
            )
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 14)
            .padding(.bottom, 12)

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
                menuMetrics
            }
            .padding(.vertical, 12)

            quotaSummary

            Divider()

            quickSwitchSection

            if state.selectedProvider.supportsSessions {
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

    private var currentAccountSubtitle: String {
        if let name = state.activeCurrentAccountName {
            return "\(state.selectedProvider.title) · \(name)"
        }
        if state.activeCurrentUserID != nil {
            return "\(state.selectedProvider.title) 已登录"
        }
        return "未连接 \(state.selectedProvider.title)"
    }

    @ViewBuilder
    private var menuMetrics: some View {
        menuMetric("Token", DisplayFormat.tokens(state.usage.total.total))
        Divider().frame(height: 38)

        if state.selectedProvider != .workBuddy {
            if let quota = state.traeQuota {
                menuMetric(
                    "\(quotaUnitTitle(quota.unit)) 已用",
                    quotaAmount(quota.used, unit: quota.unit)
                )
                Divider().frame(height: 38)
                menuMetric(
                    "剩余",
                    quota.remaining.map {
                        quotaAmount($0, unit: quota.unit)
                    } ?? "∞"
                )
            } else {
                menuMetric("用量", "--")
                Divider().frame(height: 38)
                menuMetric("额度", "--")
            }
        } else {
            menuMetric("Credits", DisplayFormat.credits(state.usage.credits))
            Divider().frame(height: 38)
            menuMetric("对话", state.usage.sessions.count.formatted())
        }
    }

    @ViewBuilder
    private var quotaSummary: some View {
        if let quota = state.traeQuota {
            VStack(alignment: .leading, spacing: 7) {
                HStack {
                    Text(quota.packageName)
                        .lineLimit(1)
                    Spacer()
                    if let fraction = traeQuotaFraction(quota) {
                        Text(
                            fraction,
                            format: .percent.precision(.fractionLength(0))
                        )
                    } else {
                        Label("不限量", systemImage: "infinity")
                    }
                }
                .font(.system(size: 10, weight: .medium))

                if let fraction = traeQuotaFraction(quota) {
                    ProgressView(value: fraction)
                        .tint(OpenUsageColors.blue)
                }

                HStack {
                    Text(
                        "已用 \(quotaAmount(quota.used, unit: quota.unit)) \(quotaUnitTitle(quota.unit))"
                    )
                    Spacer()
                    if quota.payGoUsed > 0 {
                        Text(
                            "按量 \(quotaAmount(quota.payGoUsed, unit: quota.unit))"
                        )
                            .foregroundStyle(OpenUsageColors.coral)
                    }
                }
                .font(.system(size: 9))
                .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 12)
        } else if let quota = state.quota {
            VStack(alignment: .leading, spacing: 7) {
                HStack {
                    Text(quota.packageName ?? "本周期额度")
                    Spacer()
                    Text(
                        quota.usedFraction,
                        format: .percent.precision(.fractionLength(0))
                    )
                }
                .font(.system(size: 10, weight: .medium))
                ProgressView(value: quota.usedFraction)
                    .tint(OpenUsageColors.blue)
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 12)
        }
    }

    @ViewBuilder
    private var quickSwitchSection: some View {
        if let variant = state.selectedTraeVariant {
            let profiles = traeAccounts.accounts(for: variant)
            if !profiles.isEmpty {
                Text("快速切换")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 14)
                    .padding(.top, 12)
                    .padding(.bottom, 5)

                ForEach(profiles.prefix(5)) { profile in
                    Button {
                        Task { await state.switchTraeAccount(to: profile) }
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
                            if profile.userID == traeAccounts.currentUserID(
                                for: variant
                            ) {
                                Image(systemName: "checkmark")
                                    .foregroundStyle(OpenUsageColors.blue)
                            }
                        }
                        .padding(.horizontal, 12)
                        .frame(height: 34)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(
                        traeAccounts.switchingVariant != nil
                            || state.resumingSessionID != nil
                    )
                }
                if profiles.count > 5 {
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
        } else if !accounts.accounts.isEmpty {
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
    }

    private func traeQuotaFraction(_ quota: TraeQuotaSummary) -> Double? {
        guard let total = quota.total else { return nil }
        guard total > 0 else { return 0 }
        return min(max(quota.used / total, 0), 1)
    }

    private func quotaUnitTitle(_ unit: TraeQuotaUnit) -> String {
        switch unit {
        case .credits: return "Credits"
        case .requests: return "请求"
        }
    }

    private func quotaAmount(_ value: Double, unit: TraeQuotaUnit) -> String {
        switch unit {
        case .credits:
            return DisplayFormat.credits(value)
        case .requests:
            let fractionDigits = value.rounded() == value ? 0 : 2
            return value.formatted(
                .number.precision(.fractionLength(fractionDigits))
            )
        }
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
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }
        .frame(maxWidth: .infinity)
    }
}
