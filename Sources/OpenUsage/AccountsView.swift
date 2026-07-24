import SwiftUI

struct AccountsView: View {
    @ObservedObject var state: AppState
    @ObservedObject private var accounts: AccountStore
    @State private var renaming: AccountProfile?
    @State private var renameValue = ""
    @State private var pendingRemoval: AccountProfile?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(state: AppState) {
        self.state = state
        _accounts = ObservedObject(wrappedValue: state.accounts)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                SectionTitle(
                    title: "账号",
                    subtitle: "\(accounts.accounts.count) 个 Keychain 快照"
                )
                Spacer()
                Button {
                    state.captureCurrentAccount()
                } label: {
                    Label("保存当前账号", systemImage: "plus")
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
            }
            .padding(.horizontal, 28)
            .frame(height: 82)

            Divider()

            if accounts.accounts.isEmpty {
                EmptyStateView(
                    systemImage: "person.crop.circle.badge.plus",
                    title: "还没有账号快照",
                    message: "先在 WorkBuddy 中登录，再保存当前账号。",
                    actionTitle: "保存当前账号",
                    action: state.captureCurrentAccount
                )
                .transition(.opacity.combined(with: .offset(y: 8)))
            } else {
                ScrollView {
                    LazyVStack(spacing: 10) {
                        ForEach(accounts.accounts) { profile in
                            accountRow(profile)
                        }
                    }
                    .padding(28)
                }
            }
        }
        .animation(reduceMotion ? nil : .openUsageEase, value: accounts.accounts.count)
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
                        state.renameAccount(profile, nickname: renameValue)
                        renaming = nil
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(renameValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
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
                    state.removeAccount(profile)
                    pendingRemoval = nil
                }
            }
            Button("取消", role: .cancel) { pendingRemoval = nil }
        } message: {
            Text("只会删除 WorkBuddy Switch 钥匙串快照，不会删除 WorkBuddy 数据。")
        }
    }

    private func accountRow(_ profile: AccountProfile) -> some View {
        let isCurrent = profile.id == accounts.currentUserID
        return HStack(spacing: 14) {
            Text(profile.initials)
                .font(.system(size: 15, weight: .semibold))
                .frame(width: 36, height: 36)
                .background(
                    isCurrent
                        ? OpenUsageColors.blue.opacity(0.14)
                        : Color.primary.opacity(0.06)
                )
                .foregroundStyle(isCurrent ? OpenUsageColors.blue : Color.secondary)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 7) {
                    Text(profile.nickname)
                        .font(.system(size: 14, weight: .semibold))
                    if isCurrent {
                        Text("当前")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Color.primary)
                            .padding(.horizontal, 7)
                            .padding(.vertical, 2)
                            .background(OpenUsageColors.blue.opacity(0.10))
                            .clipShape(Capsule())
                    }
                }
                HStack(spacing: 8) {
                    Text(profile.shortID)
                        .font(.system(size: 11, design: .monospaced))
                    if let phone = profile.phoneHint {
                        Text(phone)
                    }
                    if let type = profile.accountType {
                        Text(type)
                    }
                }
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
            }

            Spacer()

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
                    .frame(width: 26, height: 26)
            }
            .menuStyle(.borderlessButton)
            .fixedSize()

            switchButton(profile, isCurrent: isCurrent)
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 70)
        .background {
            if isCurrent {
                LinearGradient(
                    colors: [OpenUsageColors.blue.opacity(0.075), Color.clear],
                    startPoint: .leading,
                    endPoint: .trailing
                )
            } else {
                Color(nsColor: .controlBackgroundColor)
            }
        }
        .overlay {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(
                    isCurrent ? OpenUsageColors.blue.opacity(0.8) : OpenUsageColors.separator,
                    lineWidth: 1
                )
        }
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    @ViewBuilder
    private func switchButton(_ profile: AccountProfile, isCurrent: Bool) -> some View {
        if isCurrent {
            accountActionButton(profile, title: "打开", isCurrent: true)
                .buttonStyle(.bordered)
        } else {
            accountActionButton(profile, title: "切换", isCurrent: false)
                .buttonStyle(.borderedProminent)
        }
    }

    private func accountActionButton(
        _ profile: AccountProfile,
        title: String,
        isCurrent: Bool
    ) -> some View {
        Button {
            Task { await state.switchAccount(to: profile) }
        } label: {
            if accounts.isSwitching && !isCurrent {
                ProgressView()
                    .controlSize(.small)
                    .frame(width: 58)
            } else {
                Text(title)
                    .frame(width: 58)
            }
        }
        .controlSize(.large)
        .disabled(accounts.isSwitching || state.resumingSessionID != nil)
    }
}
