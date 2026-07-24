import Charts
import SwiftUI

struct UsageView: View {
    enum DetailTab: String, CaseIterable, Identifiable {
        case sessions
        case models

        var id: String { rawValue }
        var title: String { self == .sessions ? "按对话" : "按模型" }
    }

    @ObservedObject var state: AppState
    @ObservedObject private var accounts: AccountStore
    @State private var detailTab: DetailTab = .sessions

    init(state: AppState) {
        self.state = state
        _accounts = ObservedObject(wrappedValue: state.accounts)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                header
                hero
                breakdown
                trend
                detail
            }
            .padding(28)
        }
        .onChange(of: state.usagePeriod) { _ in
            Task { await state.recalculateUsage() }
        }
        .onChange(of: state.usageAccountID) { _ in
            Task { await state.recalculateUsage() }
        }
    }

    private var header: some View {
        HStack {
            SectionTitle(
                title: "用量",
                subtitle: "\(state.usage.scannedFiles) 个本地记录文件"
            )
            Spacer()
            Picker("账号", selection: $state.usageAccountID) {
                Text("全部账号").tag(String?.none)
                ForEach(accounts.accounts) { account in
                    Text(account.nickname).tag(String?.some(account.id))
                }
            }
            .labelsHidden()
            .frame(width: 150)

            Picker("周期", selection: $state.usagePeriod) {
                ForEach(UsagePeriod.allCases) { period in
                    Text(period.title).tag(period)
                }
            }
            .pickerStyle(.segmented)
            .frame(width: 210)

            Button {
                Task { await state.refreshAll(force: true) }
            } label: {
                Image(systemName: "arrow.clockwise")
            }
            .buttonStyle(.bordered)
            .help("刷新")
        }
    }

    private var hero: some View {
        HStack(alignment: .bottom, spacing: 30) {
            VStack(alignment: .leading, spacing: 5) {
                Text("总 Token")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.secondary)
                Text(state.usage.total.total.formatted())
                    .font(.system(size: 40, weight: .semibold, design: .rounded))
                    .contentTransition(.numericText())
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            Divider()
                .frame(height: 62)
            VStack(alignment: .leading, spacing: 5) {
                Text("Credits")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.secondary)
                Text(DisplayFormat.credits(state.usage.credits))
                    .font(.system(size: 28, weight: .semibold, design: .rounded))
                    .contentTransition(.numericText())
            }
            Spacer()
            if let capturedAt = Optional(state.usage.capturedAt) {
                Text("更新于 \(capturedAt.formatted(date: .omitted, time: .shortened))")
                    .font(.system(size: 10))
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 4)
    }

    private var breakdown: some View {
        LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 4),
            spacing: 12
        ) {
            MetricTile(
                title: "净输入",
                value: DisplayFormat.tokens(state.usage.total.input),
                detail: "不含缓存命中",
                systemImage: "arrow.down.left",
                tint: OpenUsageColors.blue
            )
            MetricTile(
                title: "输出",
                value: DisplayFormat.tokens(state.usage.total.output),
                detail: "包含思考 Token",
                systemImage: "arrow.up.right",
                tint: OpenUsageColors.coral
            )
            MetricTile(
                title: "缓存命中",
                value: DisplayFormat.tokens(state.usage.total.cacheRead),
                detail: "prompt cache hit",
                systemImage: "bolt.horizontal.circle",
                tint: OpenUsageColors.lime
            )
            MetricTile(
                title: "思考",
                value: DisplayFormat.tokens(state.usage.total.reasoning),
                detail: "输出的子集",
                systemImage: "brain.head.profile",
                tint: OpenUsageColors.cyan
            )
        }
    }

    private var trend: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("每日趋势")
                .font(.system(size: 16, weight: .semibold))
            if state.usage.daily.isEmpty {
                EmptyStateView(
                    systemImage: "chart.line.uptrend.xyaxis",
                    title: state.usageMessage == nil ? "暂无数据" : "无法读取用量",
                    message: state.usageMessage ?? "当前筛选范围没有 token 记录。"
                )
                .frame(height: 230)
            } else {
                Chart(state.usage.daily) { point in
                    BarMark(
                        x: .value("日期", point.day, unit: .day),
                        y: .value("Token", point.tokens)
                    )
                    .foregroundStyle(
                        LinearGradient(
                            colors: [OpenUsageColors.blue, OpenUsageColors.cyan],
                            startPoint: .bottom,
                            endPoint: .top
                        )
                    )
                    .cornerRadius(3)
                }
                .chartXAxis {
                    AxisMarks(values: DisplayFormat.axisDates(state.usage.daily, maxCount: 7)) {
                        AxisGridLine().foregroundStyle(Color.primary.opacity(0.04))
                        AxisValueLabel(format: .dateTime.month().day())
                    }
                }
                .chartYAxis {
                    AxisMarks(position: .leading) {
                        AxisGridLine().foregroundStyle(Color.primary.opacity(0.06))
                        AxisValueLabel()
                    }
                }
                .frame(height: 260)
            }
        }
    }

    private var detail: some View {
        VStack(alignment: .leading, spacing: 12) {
            Picker("明细", selection: $detailTab) {
                ForEach(DetailTab.allCases) { tab in
                    Text(tab.title).tag(tab)
                }
            }
            .pickerStyle(.segmented)
            .frame(width: 220)

            if detailTab == .sessions {
                ForEach(Array(state.usage.sessions.prefix(20)).indices, id: \.self) { index in
                    let item = state.usage.sessions[index]
                    usageRow(
                        rank: index + 1,
                        title: item.title,
                        subtitle: String(item.sessionID.prefix(10)),
                        tokens: item.tokens.total,
                        credits: item.credits
                    )
                }
            } else {
                ForEach(Array(state.usage.models.prefix(20)).indices, id: \.self) { index in
                    let item = state.usage.models[index]
                    usageRow(
                        rank: index + 1,
                        title: item.model,
                        subtitle: "模型",
                        tokens: item.tokens,
                        credits: item.credits
                    )
                }
            }
        }
    }

    private func usageRow(
        rank: Int,
        title: String,
        subtitle: String,
        tokens: Int,
        credits: Double
    ) -> some View {
        HStack(spacing: 12) {
            Text(rank.formatted())
                .font(.system(size: 11, weight: .semibold, design: .rounded))
                .foregroundStyle(.tertiary)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 12, weight: .semibold))
                    .lineLimit(1)
                Text(subtitle)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(.tertiary)
            }
            Spacer()
            Text(DisplayFormat.tokens(tokens))
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .frame(width: 90, alignment: .trailing)
            Text(DisplayFormat.credits(credits))
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
                .frame(width: 70, alignment: .trailing)
        }
        .padding(.vertical, 8)
        .overlay(alignment: .bottom) { Divider() }
    }
}
