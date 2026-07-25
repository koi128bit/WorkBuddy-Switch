import AppKit
import SwiftUI

enum OpenUsageColors {
    static let blue = Color(red: 0.09, green: 0.51, blue: 1.0)
    static let cyan = Color(red: 0.20, green: 0.79, blue: 0.94)
    static let lime = Color(red: 0.63, green: 0.86, blue: 0.24)
    static let coral = Color(red: 1.0, green: 0.43, blue: 0.31)
    static let orange = Color(red: 1.0, green: 0.42, blue: 0.10)
    static let violet = Color(red: 0.63, green: 0.30, blue: 0.98)
    static let mint = Color(red: 0.08, green: 0.76, blue: 0.53)
    static let ink = Color(red: 0.08, green: 0.08, blue: 0.09)
    static let separator = Color.primary.opacity(0.10)
    static let faintFill = Color.primary.opacity(0.035)
    static let toolbarFill = Color.primary.opacity(0.055)
}

struct AppIconView: View {
    var size: CGFloat = 36

    var body: some View {
        Group {
            if let url = Bundle.main.url(forResource: "AppIcon", withExtension: "png"),
               let image = NSImage(contentsOf: url) {
                Image(nsImage: image)
                    .resizable()
                    .interpolation(.high)
            } else {
                Image(systemName: "chart.bar.fill")
                    .resizable()
                    .scaledToFit()
                    .padding(size * 0.2)
                    .background(OpenUsageColors.blue)
                    .foregroundStyle(.white)
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: size * 0.22, style: .continuous))
    }
}

struct WorkbenchControlGroup<Content: View>: View {
    private let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .padding(4)
            .background(OpenUsageColors.toolbarFill)
            .overlay {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(OpenUsageColors.separator, lineWidth: 1)
            }
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

struct WorkbenchNavigationButton: View {
    let title: String
    let systemImage: String
    let isSelected: Bool
    let action: () -> Void

    @State private var isHovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(isSelected ? Color.primary : Color.secondary)
                .frame(width: 34, height: 32)
                .background {
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .fill(backgroundColor)
                        .shadow(
                            color: isSelected ? Color.black.opacity(0.07) : .clear,
                            radius: 2,
                            y: 1
                        )
                }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { isHovering = $0 }
        .help(title)
        .accessibilityLabel(title)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var backgroundColor: Color {
        if isSelected {
            return Color(nsColor: .controlBackgroundColor)
        }
        if isHovering {
            return Color.primary.opacity(0.05)
        }
        return .clear
    }
}

struct SpectralRibbonField: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(reduceMotion ? .periodic(from: .now, by: 3_600) : .periodic(from: .now, by: 0.1)) {
            timeline in
            Canvas { context, size in
                let time = reduceMotion ? 0 : timeline.date.timeIntervalSinceReferenceDate
                let colors = [
                    OpenUsageColors.blue.opacity(0.34),
                    OpenUsageColors.cyan.opacity(0.28),
                    OpenUsageColors.lime.opacity(0.20),
                    OpenUsageColors.coral.opacity(0.18)
                ]

                context.addFilter(.blur(radius: 18))
                for index in 0..<8 {
                    let phase = time * (0.18 + Double(index) * 0.012) + Double(index) * 0.72
                    var path = Path()
                    let baseY = size.height * (0.18 + CGFloat(index) * 0.09)
                    path.move(to: CGPoint(x: -80, y: baseY))
                    let steps = 42
                    for step in 0...steps {
                        let x = (CGFloat(step) / CGFloat(steps)) * (size.width + 160) - 80
                        let wave = sin(Double(x / max(size.width, 1)) * 7.0 + phase)
                        let secondary = cos(Double(x / max(size.width, 1)) * 3.4 - phase * 0.7)
                        let y = baseY + CGFloat(wave * 18 + secondary * 8)
                        path.addLine(to: CGPoint(x: x, y: y))
                    }
                    context.stroke(
                        path,
                        with: .color(colors[index % colors.count]),
                        style: StrokeStyle(
                            lineWidth: 28 + CGFloat(index % 3) * 8,
                            lineCap: .round,
                            lineJoin: .round
                        )
                    )
                }
            }
        }
        .background(
            LinearGradient(
                colors: [
                    Color(nsColor: .windowBackgroundColor),
                    Color(nsColor: .windowBackgroundColor).opacity(0.88)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
        )
        .allowsHitTesting(false)
    }
}

struct SectionTitle: View {
    let title: String
    var subtitle: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.system(size: 24, weight: .semibold))
            if let subtitle {
                Text(subtitle)
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
            }
        }
    }
}

struct PanelSurface<Content: View>: View {
    private let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .padding(20)
            .background(Color(nsColor: .controlBackgroundColor))
            .overlay {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(OpenUsageColors.separator, lineWidth: 1)
            }
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

struct MetricTile: View {
    let title: String
    let value: String
    let detail: String
    let systemImage: String
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Image(systemName: systemImage)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(tint)
                    .frame(width: 28, height: 28)
                    .background(tint.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                Spacer()
                Text(title)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.secondary)
            }
            Text(value)
                .font(.system(size: 25, weight: .semibold, design: .rounded))
                .contentTransition(.numericText())
                .lineLimit(1)
                .minimumScaleFactor(0.75)
            Text(detail)
                .font(.system(size: 11))
                .foregroundStyle(.tertiary)
                .lineLimit(1)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(nsColor: .controlBackgroundColor))
        .overlay {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(OpenUsageColors.separator, lineWidth: 1)
        }
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

struct EmptyStateView: View {
    let systemImage: String
    let title: String
    let message: String
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.system(size: 30, weight: .light))
                .foregroundStyle(.secondary)
            Text(title)
                .font(.system(size: 16, weight: .semibold))
            Text(message)
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 340)
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .padding(.top, 4)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(40)
    }
}

enum DisplayFormat {
    static func tokens(_ value: Int) -> String {
        switch value {
        case 1_000_000_000...:
            return String(format: "%.2fB", Double(value) / 1_000_000_000)
        case 1_000_000...:
            return String(format: "%.2fM", Double(value) / 1_000_000)
        case 1_000...:
            return String(format: "%.1fK", Double(value) / 1_000)
        default:
            return value.formatted()
        }
    }

    static func credits(_ value: Double) -> String {
        String(format: "%.2f", value)
    }

    static func axisTokens(_ value: Double) -> String {
        let magnitude = abs(value)
        switch magnitude {
        case 1_000_000_000...:
            return String(format: "%.1fB", value / 1_000_000_000)
        case 1_000_000...:
            return String(format: "%.1fM", value / 1_000_000)
        case 1_000...:
            return String(format: "%.0fK", value / 1_000)
        default:
            return String(format: "%.0f", value)
        }
    }

    static func relativeDate(_ date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter.localizedString(for: date, relativeTo: Date())
    }

    static func axisDates(_ points: [DailyUsagePoint], maxCount: Int) -> [Date] {
        let dates = points.map(\.day)
        guard maxCount > 1, dates.count > maxCount else { return dates }

        let lastIndex = dates.count - 1
        let interval = Double(lastIndex) / Double(maxCount - 1)
        return (0..<maxCount).reduce(into: [Date]()) { result, position in
            let index = min(Int((Double(position) * interval).rounded()), lastIndex)
            let date = dates[index]
            if result.last != date {
                result.append(date)
            }
        }
    }
}

extension Animation {
    static let openUsageEase = Animation.timingCurve(0.22, 1, 0.36, 1, duration: 0.56)
    static let openUsageQuick = Animation.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.2)
    static let workbenchProviderSwitch = Animation.easeOut(duration: 0.15)
    static let workbenchPageSwitch = Animation.easeOut(duration: 0.20)
}
