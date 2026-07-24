import Charts
import SwiftUI

struct OverviewView: View {
    @ObservedObject var state: AppState
    @ObservedObject private var accounts: AccountStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(state: AppState) {
        self.state = state
        _accounts = ObservedObject(wrappedValue: state.accounts)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                hero
                metrics
                HStack(alignment: .top, spacing: 22) {
                    trend
                        .frame(maxWidth: .infinity)
                    quotaPanel
                        .frame(width: 260)
                }
                recentSessions
            }
            .padding(.horizontal, 28)
            .padding(.bottom, 32)
        }
        .toolbar {
            ToolbarItemGroup {
                if state.isRefreshing {
                    ProgressView()
                        .controlSize(.small)
                }
                Button {
                    Task { await state.refreshAll(force: true) }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .help("刷新")
                .accessibilityLabel("刷新")
            }
        }
    }

    private var hero: some View {
        ZStack(alignment: .leading) {
            SpectralRibbonField()
            VStack(alignment: .leading, spacing: 10) {
                Text("WorkBuddy Switch")
                    .font(.system(size: 38, weight: .semibold))
                Text(accounts.currentAccount?.nickname ?? "尚未捕获 WorkBuddy 账号")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(.secondary)
                HStack(spacing: 8) {
                    Circle()
                        .fill(accounts.currentUserID == nil ? Color.orange : Color.green)
                        .frame(width: 7, height: 7)
                    Text(accounts.currentUserID == nil ? "等待登录" : "WorkBuddy 认证已读取")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 26)
        }
        .frame(height: 190)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(OpenUsageColors.separator, lineWidth: 1)
        }
        .padding(.top, 18)
    }

    private var metrics: some View {
        LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 4),
            spacing: 12
        ) {
            MetricTile(
                title: "Token",
                value: DisplayFormat.tokens(state.usage.total.total),
                detail: state.usagePeriod.title,
                systemImage: "number",
                tint: OpenUsageColors.blue
            )
            MetricTile(
                title: "Credits",
                value: DisplayFormat.credits(state.usage.credits),
                detail: "WorkBuddy 计量",
                systemImage: "bolt.fill",
                tint: OpenUsageColors.coral
            )
            MetricTile(
                title: "对话",
                value: state.usage.sessions.count.formatted(),
                detail: "\(state.sessions.filter { !$0.isDeleted && state.canResume($0) }.count) 个可恢复",
                systemImage: "bubble.left.and.bubble.right.fill",
                tint: OpenUsageColors.cyan
            )
            MetricTile(
                title: "账号",
                value: accounts.accounts.count.formatted(),
                detail: accounts.currentAccount?.shortID ?? "未连接",
                systemImage: "person.2.fill",
                tint: OpenUsageColors.lime
            )
        }
    }

    private var trend: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("Token 趋势")
                    .font(.system(size: 16, weight: .semibold))
                Spacer()
                Text(state.usagePeriod.title)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.secondary)
            }
            if state.usage.daily.isEmpty {
                EmptyStateView(
                    systemImage: "chart.xyaxis.line",
                    title: "暂无用量",
                    message: "产生 WorkBuddy 对话后，趋势会出现在这里。"
                )
                .frame(height: 190)
            } else {
                Chart(state.usage.daily) { point in
                    AreaMark(
                        x: .value("日期", point.day),
                        y: .value("Token", Double(point.tokens))
                    )
                    .foregroundStyle(
                        LinearGradient(
                            colors: [
                                OpenUsageColors.blue.opacity(0.22),
                                OpenUsageColors.blue.opacity(0.01)
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    LineMark(
                        x: .value("日期", point.day),
                        y: .value("Token", Double(point.tokens))
                    )
                    .foregroundStyle(OpenUsageColors.blue)
                    .interpolationMethod(.catmullRom)
                }
                .chartXAxis {
                    AxisMarks(values: DisplayFormat.axisDates(state.usage.daily, maxCount: 5)) {
                        AxisGridLine().foregroundStyle(Color.primary.opacity(0.05))
                        AxisValueLabel(format: .dateTime.month().day())
                    }
                }
                .chartYAxis {
                    AxisMarks(position: .leading) { value in
                        AxisGridLine().foregroundStyle(Color.primary.opacity(0.06))
                        AxisValueLabel {
                            if let tokens = value.as(Double.self) {
                                Text(DisplayFormat.axisTokens(tokens))
                            }
                        }
                    }
                }
                .frame(height: 210)
            }
        }
        .padding(.vertical, 4)
    }

    private var quotaPanel: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("本周期额度")
                .font(.system(size: 16, weight: .semibold))
            if let quota = state.quota {
                ZStack {
                    Circle()
                        .stroke(Color.primary.opacity(0.07), lineWidth: 11)
                    Circle()
                        .trim(from: 0, to: quota.usedFraction)
                        .stroke(
                            AngularGradient(
                                colors: [
                                    OpenUsageColors.blue,
                                    OpenUsageColors.cyan,
                                    OpenUsageColors.lime
                                ],
                                center: .center
                            ),
                            style: StrokeStyle(lineWidth: 11, lineCap: .round)
                        )
                    .rotationEffect(.degrees(-90))
                        .animation(
                            reduceMotion ? nil : .easeOut(duration: 0.8),
                            value: quota.usedFraction
                        )
                    VStack(spacing: 3) {
                        Text(quota.usedFraction, format: .percent.precision(.fractionLength(0)))
                            .font(.system(size: 25, weight: .semibold, design: .rounded))
                        Text("已使用")
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                    }
                }
                .frame(width: 126, height: 126)
                .frame(maxWidth: .infinity)
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(quota.packageName ?? "WorkBuddy")
                            .font(.system(size: 12, weight: .semibold))
                        Text("剩余 \(DisplayFormat.credits(quota.remaining))")
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    if let resetsAt = quota.resetsAt {
                        Text(resetsAt, format: .dateTime.month().day())
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(.secondary)
                    }
                }
            } else {
                EmptyStateView(
                    systemImage: "gauge.with.dots.needle.33percent",
                    title: "额度不可用",
                    message: state.quotaMessage ?? "登录后刷新额度。"
                )
                .frame(height: 190)
            }
        }
        .padding(.vertical, 4)
    }

    private var recentSessions: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("最近对话")
                    .font(.system(size: 16, weight: .semibold))
                Spacer()
                Button("查看全部") {
                    state.selectedSection = .sessions
                }
                .buttonStyle(.link)
            }
            ForEach(Array(state.sessions.filter { !$0.isDeleted }.prefix(4))) { session in
                HStack(spacing: 12) {
                    Image(systemName: "bubble.left")
                        .foregroundStyle(OpenUsageColors.blue)
                        .frame(width: 28, height: 28)
                        .background(OpenUsageColors.blue.opacity(0.10))
                        .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                    VStack(alignment: .leading, spacing: 3) {
                        Text(session.title)
                            .font(.system(size: 13, weight: .semibold))
                            .lineLimit(1)
                        Text("\(session.directoryName) · \(DisplayFormat.relativeDate(session.updatedAt))")
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                Button {
                    Task { await state.resume(session) }
                } label: {
                    Image(systemName: "arrow.up.forward.app")
                }
                .buttonStyle(.borderless)
                .help("恢复对话")
                .accessibilityLabel("恢复对话")
                .disabled(!state.canResume(session))
                }
                .padding(.vertical, 8)
                .overlay(alignment: .bottom) {
                    Divider()
                }
            }
        }
    }
}
