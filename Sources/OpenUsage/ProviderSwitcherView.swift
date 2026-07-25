import SwiftUI

extension ManagedProvider {
    var switcherCompactTitle: String {
        switch self {
        case .workBuddy:
            return "WB"
        case .traeCN:
            return "CN"
        case .traeWork:
            return "Work"
        }
    }

    var switcherTint: Color {
        switch self {
        case .workBuddy:
            return OpenUsageColors.blue
        case .traeCN:
            return OpenUsageColors.cyan
        case .traeWork:
            return OpenUsageColors.violet
        }
    }
}

struct ProviderSwitcherView: View {
    @Binding var selection: ManagedProvider
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var selectionIndicator

    var body: some View {
        ViewThatFits(in: .horizontal) {
            switcher(showsFullTitles: true)
            switcher(showsFullTitles: false)
        }
        .animation(
            reduceMotion ? nil : .workbenchProviderSwitch,
            value: selection
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel("应用")
    }

    private func switcher(showsFullTitles: Bool) -> some View {
        HStack(spacing: 3) {
            ForEach(ManagedProvider.allCases) { provider in
                ProviderSwitchButton(
                    provider: provider,
                    isSelected: provider == selection,
                    showsFullTitle: showsFullTitles,
                    selectionIndicator: selectionIndicator
                ) {
                    selection = provider
                }
            }
        }
        .padding(4)
        .fixedSize(horizontal: true, vertical: false)
        .background(OpenUsageColors.toolbarFill)
        .overlay {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(OpenUsageColors.separator, lineWidth: 1)
        }
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

private struct ProviderSwitchButton: View {
    let provider: ManagedProvider
    let isSelected: Bool
    let showsFullTitle: Bool
    let selectionIndicator: Namespace.ID
    let action: () -> Void

    @State private var isHovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                providerGlyph
                Text(showsFullTitle ? provider.title : provider.switcherCompactTitle)
                    .font(.system(size: 12, weight: .semibold))
                    .lineLimit(1)
            }
            .foregroundStyle(isSelected ? Color.primary : Color.secondary)
            .padding(.horizontal, showsFullTitle ? 11 : 8)
            .frame(height: 32)
            .background {
                if isSelected {
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .fill(Color(nsColor: .controlBackgroundColor))
                        .matchedGeometryEffect(
                            id: "managed-provider-selection",
                            in: selectionIndicator
                        )
                        .shadow(color: Color.black.opacity(0.07), radius: 2, y: 1)
                } else if isHovering {
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .fill(Color.primary.opacity(0.045))
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { isHovering = $0 }
        .help("切换到 \(provider.title)")
        .accessibilityLabel(provider.title)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var providerGlyph: some View {
        Image(systemName: provider.systemImage)
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(provider.switcherTint)
            .frame(width: 22, height: 22)
            .background(provider.switcherTint.opacity(0.11))
            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            .accessibilityHidden(true)
    }
}
