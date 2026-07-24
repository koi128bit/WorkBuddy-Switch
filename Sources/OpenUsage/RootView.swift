import SwiftUI

struct RootView: View {
    @ObservedObject var state: AppState
    @ObservedObject private var accounts: AccountStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(state: AppState) {
        self.state = state
        _accounts = ObservedObject(wrappedValue: state.accounts)
    }

    var body: some View {
        NavigationSplitView {
            sidebar
                .navigationSplitViewColumnWidth(min: 196, ideal: 212, max: 230)
        } detail: {
            content
                .id(state.selectedSection)
                .transition(.opacity)
                .animation(reduceMotion ? nil : .openUsageQuick, value: state.selectedSection)
        }
        .navigationSplitViewStyle(.balanced)
        .background(Color(nsColor: .windowBackgroundColor))
        .alert(item: $state.alert) { alert in
            Alert(
                title: Text(alert.title),
                message: Text(alert.message),
                dismissButton: .default(Text("好"))
            )
        }
    }

    private var sidebar: some View {
        VStack(spacing: 0) {
            HStack(spacing: 11) {
                AppIconView(size: 38)
                VStack(alignment: .leading, spacing: 1) {
                    Text("OpenUsage")
                        .font(.system(size: 16, weight: .semibold))
                    Text("WorkBuddy")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(.secondary)
                }
                Spacer()
            }
            .padding(.horizontal, 16)
            .frame(height: 64)

            VStack(spacing: 4) {
                ForEach(AppSection.allCases) { section in
                    Button {
                        withAnimation(.openUsageQuick) {
                            state.selectedSection = section
                        }
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: section.systemImage)
                                .font(.system(size: 13, weight: .medium))
                                .frame(width: 18)
                            Text(section.title)
                                .font(.system(size: 13, weight: .medium))
                            Spacer()
                        }
                        .foregroundStyle(
                            state.selectedSection == section ? Color.primary : Color.secondary
                        )
                        .padding(.horizontal, 11)
                        .frame(height: 36)
                        .background {
                            if state.selectedSection == section {
                                RoundedRectangle(cornerRadius: 7, style: .continuous)
                                    .fill(Color.primary.opacity(0.075))
                            }
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(
                        state.selectedSection == section ? .isSelected : []
                    )
                }
            }
            .padding(.horizontal, 10)
            .padding(.top, 8)

            Spacer()

            if let current = accounts.currentAccount {
                Button {
                    state.selectedSection = .accounts
                } label: {
                    HStack(spacing: 10) {
                        Text(current.initials)
                            .font(.system(size: 12, weight: .semibold))
                            .frame(width: 30, height: 30)
                            .background(OpenUsageColors.blue.opacity(0.14))
                            .foregroundStyle(OpenUsageColors.blue)
                            .clipShape(Circle())
                        VStack(alignment: .leading, spacing: 2) {
                            Text(current.nickname)
                                .font(.system(size: 12, weight: .semibold))
                                .lineLimit(1)
                            Text(current.shortID)
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundStyle(.tertiary)
                        }
                        Spacer()
                        Circle()
                            .fill(Color.green)
                            .frame(width: 7, height: 7)
                            .accessibilityHidden(true)
                    }
                    .padding(10)
                    .background(Color.primary.opacity(0.035))
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 10)
                .padding(.bottom, 12)
            } else {
                Button {
                    state.selectedSection = .accounts
                } label: {
                    Label("添加 WorkBuddy 账号", systemImage: "person.badge.plus")
                        .font(.system(size: 12, weight: .medium))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(11)
                        .background(Color.primary.opacity(0.035))
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
                .buttonStyle(.plain)
                .padding(10)
            }
        }
        .background(.ultraThinMaterial)
    }

    @ViewBuilder
    private var content: some View {
        switch state.selectedSection {
        case .overview:
            OverviewView(state: state)
        case .accounts:
            AccountsView(state: state)
        case .sessions:
            SessionsView(state: state)
        case .usage:
            UsageView(state: state)
        case .settings:
            SettingsView(state: state)
        }
    }
}
