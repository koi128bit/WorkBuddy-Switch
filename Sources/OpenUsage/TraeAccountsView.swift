import SwiftUI

struct TraeAccountsView: View {
    @ObservedObject var state: AppState
    @ObservedObject private var accounts: TraeAccountStore
    let variant: TraeVariant

    @State private var renaming: TraeAccountProfile?
    @State private var renameValue = ""
    @State private var pendingRemoval: TraeAccountProfile?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(state: AppState, variant: TraeVariant) {
        self.state = state
        self.variant = variant
        _accounts = ObservedObject(wrappedValue: state.traeAccounts)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                SectionTitle(
                    title: "\(variant.displayName) 账号",
                    subtitle: "\(profiles.count) 个 Keychain 快照"
                )
                Spacer()
                Button {
                    state.captureCurrentAccount()
                } label: {
                    Label("保存当前账号", systemImage: "plus")
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(accounts.switchingVariant != nil)
            }
            .padding(.horizontal, 28)
            .frame(height: 82)

            Divider()

            if profiles.isEmpty {
                EmptyStateView(
                    systemImage: "person.crop.circle.badge.plus",
                    title: "还没有 \(variant.displayName) 账号快照",
                    message: emptyMessage,
                    actionTitle: "保存当前账号",
                    action: state.captureCurrentAccount
                )
                .transition(.opacity.combined(with: .offset(y: 8)))
            } else {
                ScrollView {
                    LazyVStack(spacing: 12) {
                        ForEach(profiles) { profile in
                            accountRow(profile)
                        }
                    }
                    .padding(28)
                }
            }
        }
        .animation(reduceMotion ? nil : .openUsageEase, value: profiles.count)
        .sheet(item: $renaming) { profile in
            VStack(alignment: .leading, spacing: 18) {
                Text("重命名账号")
                    .font(.system(size: 20, weight: .semibold))
                TextField("账号名称", text: $renameValue)
                    .textFieldStyle(.roundedBorder)
                HStack {
                    Spacer()
                    Button("取消") { renaming = nil }
                    Button("保存") {
                        state.renameTraeAccount(profile, nickname: renameValue)
                        renaming = nil
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(
                        renameValue
                            .trimmingCharacters(in: .whitespacesAndNewlines)
                            .isEmpty
                    )
                }
            }
            .padding(24)
            .frame(width: 420)
        }
        .confirmationDialog(
            "移除这个账号快照？",
            isPresented: Binding(
                get: { pendingRemoval != nil },
                set: { if !$0 { pendingRemoval = nil } }
            )
        ) {
            if let profile = pendingRemoval {
                Button("从 WorkBuddy Switch 移除", role: .destructive) {
                    state.removeTraeAccount(profile)
                    pendingRemoval = nil
                }
            }
            Button("取消", role: .cancel) { pendingRemoval = nil }
        } message: {
            Text(
                "只会删除 WorkBuddy Switch 钥匙串快照，不会删除 \(variant.displayName) 的设置、插件或会话。"
            )
        }
    }

    private var profiles: [TraeAccountProfile] {
        accounts.accounts(for: variant)
    }

    private var emptyMessage: String {
        if accounts.applicationURL(for: variant) == nil {
            return "未检测到 \(variant.displayName)。安装并登录后即可保存账号。"
        }
        return "先在 \(variant.displayName) 中登录，再保存当前账号。"
    }

    private func accountRow(_ profile: TraeAccountProfile) -> some View {
        let isCurrent = profile.userID == accounts.currentUserID(for: variant)
        return HStack(spacing: 15) {
            Text(profile.initials)
                .font(.system(size: 15, weight: .semibold))
                .frame(width: 42, height: 42)
                .background(
                    (isCurrent ? variant.providerTint : Color.secondary)
                        .opacity(isCurrent ? 0.15 : 0.09)
                )
                .foregroundStyle(isCurrent ? variant.providerTint : Color.secondary)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 8) {
                    Text(profile.nickname)
                        .font(.system(size: 15, weight: .semibold))
                        .lineLimit(1)
                    if isCurrent {
                        Text("当前使用")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(OpenUsageColors.mint)
                            .padding(.horizontal, 7)
                            .padding(.vertical, 3)
                            .background(OpenUsageColors.mint.opacity(0.10))
                            .clipShape(Capsule())
                    }
                }
                HStack(spacing: 9) {
                    if let email = profile.email, !email.isEmpty {
                        Text(email)
                    }
                    Text(profile.shortID)
                        .font(.system(size: 11, design: .monospaced))
                }
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }

            Spacer(minLength: 16)

            Text("上次使用 \(DisplayFormat.relativeDate(profile.lastUsedAt))")
                .font(.system(size: 11))
                .foregroundStyle(.tertiary)

            Menu {
                Button("重命名", systemImage: "pencil") {
                    renameValue = profile.nickname
                    renaming = profile
                }
                Button("移除快照", systemImage: "trash", role: .destructive) {
                    pendingRemoval = profile
                }
            } label: {
                Image(systemName: "ellipsis")
                    .frame(width: 28, height: 28)
            }
            .menuStyle(.borderlessButton)
            .fixedSize()

            switchButton(profile, isCurrent: isCurrent)
        }
        .padding(.horizontal, 18)
        .frame(minHeight: 82)
        .background(
            isCurrent
                ? variant.providerTint.opacity(0.055)
                : Color(nsColor: .controlBackgroundColor)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(
                    isCurrent
                        ? variant.providerTint.opacity(0.75)
                        : OpenUsageColors.separator,
                    lineWidth: 1
                )
        }
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    @ViewBuilder
    private func switchButton(
        _ profile: TraeAccountProfile,
        isCurrent: Bool
    ) -> some View {
        if isCurrent {
            accountActionButton(profile, title: "打开")
                .buttonStyle(.bordered)
        } else {
            accountActionButton(profile, title: "切换")
                .buttonStyle(.borderedProminent)
        }
    }

    private func accountActionButton(
        _ profile: TraeAccountProfile,
        title: String
    ) -> some View {
        Button {
            Task { await state.switchTraeAccount(to: profile) }
        } label: {
            if accounts.isSwitching(variant) {
                ProgressView()
                    .controlSize(.small)
                    .frame(width: 64)
            } else {
                Text(title)
                    .frame(width: 64)
            }
        }
        .controlSize(.large)
        .disabled(accounts.switchingVariant != nil)
    }
}

private extension TraeVariant {
    var providerTint: Color {
        switch self {
        case .china: return OpenUsageColors.cyan
        case .work: return OpenUsageColors.violet
        }
    }
}
