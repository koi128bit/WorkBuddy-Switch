import SwiftUI

struct RootView: View {
    @ObservedObject var state: AppState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(state: AppState) {
        self.state = state
    }

    var body: some View {
        VStack(spacing: 0) {
            topBar
                .zIndex(1)

            Divider()

            ZStack {
                content
                    .id(navigationIdentity)
                    .transition(reduceMotion ? .identity : .opacity)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .animation(
                reduceMotion ? nil : .workbenchPageSwitch,
                value: navigationIdentity
            )
        }
        .background(Color(nsColor: .windowBackgroundColor))
        .onChange(of: state.selectedProvider) { provider in
            guard !provider.supportsSessions,
                  state.selectedSection == .sessions
            else {
                return
            }
            selectSection(.overview)
        }
        .alert(item: $state.alert) { alert in
            Alert(
                title: Text(alert.title),
                message: Text(alert.message),
                dismissButton: .default(Text("好"))
            )
        }
    }

    private var topBar: some View {
        HStack(spacing: 18) {
            Button {
                selectSection(.overview)
            } label: {
                HStack(spacing: 10) {
                    AppIconView(size: 34)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("WorkBuddy Switch")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(.primary)
                            .lineLimit(1)
                        Text(state.selectedProvider.title)
                            .id(state.selectedProvider)
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("返回概览")
            .accessibilityLabel("WorkBuddy Switch，返回概览")
            .frame(width: 190, alignment: .leading)

            Spacer()

            ProviderSwitcherView(
                selection: Binding(
                    get: { state.selectedProvider },
                    set: { provider in
                        selectProvider(provider)
                    }
                )
            )
            .frame(maxWidth: 420)

            WorkbenchControlGroup {
                HStack(spacing: 2) {
                    ForEach(visibleSections) { section in
                        WorkbenchNavigationButton(
                            title: section.title,
                            systemImage: section.systemImage,
                            isSelected: state.selectedSection == section
                        ) {
                            selectSection(section)
                        }
                    }
                }
            }
        }
        .padding(.horizontal, 22)
        .frame(height: 68)
        .background(.ultraThinMaterial)
    }

    private var visibleSections: [AppSection] {
        AppSection.allCases.filter {
            $0 != .sessions || state.selectedProvider.supportsSessions
        }
    }

    private var navigationIdentity: String {
        "\(String(describing: state.selectedProvider)):\(state.selectedSection.rawValue)"
    }

    private func selectProvider(_ provider: ManagedProvider) {
        guard provider != state.selectedProvider else { return }
        withAnimation(reduceMotion ? nil : .workbenchProviderSwitch) {
            state.selectProvider(provider)
            if !provider.supportsSessions,
               state.selectedSection == .sessions {
                state.selectedSection = .overview
            }
        }
    }

    private func selectSection(_ section: AppSection) {
        guard section != state.selectedSection else { return }
        guard section != .sessions || state.selectedProvider.supportsSessions else {
            return
        }
        withAnimation(reduceMotion ? nil : .workbenchPageSwitch) {
            state.selectedSection = section
        }
    }

    @ViewBuilder
    private var content: some View {
        switch state.selectedSection {
        case .overview:
            OverviewView(state: state)
        case .accounts:
            if let variant = state.selectedTraeVariant {
                TraeAccountsView(state: state, variant: variant)
            } else {
                AccountsView(state: state)
            }
        case .sessions:
            SessionsView(state: state)
        case .usage:
            UsageView(state: state)
        case .settings:
            SettingsView(state: state)
        }
    }
}
