import Charts
import SwiftUI

struct UsageView: View {
    private struct UsageFilterID: Hashable {
        let accountID: String?
        let range: UsageDateRange
    }

    private struct TrendPoint: Identifiable {
        let day: Date
        let tokens: TokenBreakdown

        var id: Date { day }
    }

    enum DetailTab: String, CaseIterable, Identifiable {
        case sessions
        case models

        var id: String { rawValue }
        var title: String { self == .sessions ? "对话统计" : "模型统计" }
        var systemImage: String {
            self == .sessions ? "bubble.left.and.bubble.right" : "chart.bar.xaxis"
        }
    }

    @ObservedObject var state: AppState
    @ObservedObject private var accounts: AccountStore
    @State private var detailTab: DetailTab = .sessions
    @State private var selectedModel: String?

    init(state: AppState) {
        self.state = state
        _accounts = ObservedObject(wrappedValue: state.accounts)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header
                summary
                trend
                detail
            }
            .padding(.horizontal, 28)
            .padding(.top, 24)
            .padding(.bottom, 34)
        }
        .onChange(of: state.usageAccountID) { _ in
            selectedModel = nil
        }
        .onChange(of: selectedModel) { model in
            if model != nil {
                detailTab = .models
            }
        }
        .onChange(of: state.usage.models) { models in
            if let selectedModel,
               !models.contains(where: { $0.model == selectedModel }) {
                self.selectedModel = nil
            }
        }
        .task(id: usageFilterID) {
            await state.recalculateUsage()
        }
        .task {
            while !Task.isCancelled {
                do {
                    try await Task.sleep(nanoseconds: 15_000_000_000)
                } catch {
                    return
                }
                guard !Task.isCancelled else { return }
                await state.refreshUsageIfIdle()
            }
        }
    }

    private var usageFilterID: UsageFilterID {
        UsageFilterID(
            accountID: state.usageAccountID,
            range: state.usageDateRange
        )
    }

    private var availableModels: [ModelUsageSummary] {
        state.usage.models.sorted {
            $0.model.localizedCaseInsensitiveCompare($1.model) == .orderedAscending
        }
    }

    private var selectedModelSummary: ModelUsageSummary? {
        guard let selectedModel else { return nil }
        return state.usage.models.first { $0.model == selectedModel }
    }

    private var headlineTokens: Int {
        selectedBreakdown.total
    }

    private var headlineCredits: Double {
        selectedModelSummary?.credits ?? state.usage.credits
    }

    private var relevantQuota: QuotaSnapshot? {
        guard let quota = state.quota else { return nil }
        if let accountID = state.usageAccountID, accountID != quota.sourceUserID {
            return nil
        }
        return quota
    }

    private var unattributedCycleCredits: Double? {
        guard
            let quota = relevantQuota,
            let local = state.locallyAttributedCycleCredits
        else {
            return nil
        }
        return max(quota.used - local, 0)
    }

    private var selectedBreakdown: TokenBreakdown {
        selectedModelSummary?.tokens ?? state.usage.total
    }

    private var cacheHitRate: Double {
        let eligible = selectedBreakdown.input
            + selectedBreakdown.cacheRead
            + selectedBreakdown.cacheWrite
        guard eligible > 0 else { return 0 }
        return min(max(Double(selectedBreakdown.cacheRead) / Double(eligible), 0), 1)
    }

    private var visibleModels: [ModelUsageSummary] {
        guard let selectedModel else { return state.usage.models }
        return state.usage.models.filter { $0.model == selectedModel }
    }

    private var trendPoints: [TrendPoint] {
        if usesHourlyTrend {
            if let selectedModel {
                return state.usage.modelHourly
                    .filter { $0.model == selectedModel }
                    .map { TrendPoint(day: $0.hour, tokens: $0.tokens) }
            }
            return state.usage.hourly.map {
                TrendPoint(day: $0.hour, tokens: $0.breakdown)
            }
        }

        if let selectedModel {
            return state.usage.modelDaily
                .filter { $0.model == selectedModel }
                .map { TrendPoint(day: $0.day, tokens: $0.tokens) }
        }
        return state.usage.daily.map {
            TrendPoint(day: $0.day, tokens: $0.breakdown)
        }
    }

    private var usesHourlyTrend: Bool {
        state.usageDateRange.spansSingleDay()
    }

    private var rangeTitle: String {
        guard state.usagePeriod == .custom else {
            return state.usagePeriod.title
        }
        let start = state.usageStartDate
        let end = state.usageEndDate
        if Calendar.current.isDate(start, inSameDayAs: end) {
            return start.formatted(.dateTime.year().month().day())
        }
        return "\(start.formatted(.dateTime.month().day())) - \(end.formatted(.dateTime.month().day()))"
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .bottom) {
                SectionTitle(
                    title: "使用统计",
                    subtitle: "查看 WorkBuddy 模型的本地 Token 用量与 Credits"
                )
                Spacer()
                Text("\(state.usage.scannedFiles) 个记录文件")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.tertiary)
            }

            HStack(spacing: 10) {
                filterPicker(
                    title: "账号",
                    systemImage: "person.crop.circle",
                    width: 164
                ) {
                    Picker("账号", selection: $state.usageAccountID) {
                        Text("全部账号").tag(String?.none)
                        ForEach(accounts.accounts) { account in
                            Text(account.nickname).tag(String?.some(account.id))
                        }
                    }
                }

                filterPicker(
                    title: "模型",
                    systemImage: "cpu",
                    width: 180
                ) {
                    Picker("模型", selection: $selectedModel) {
                        Text("全部模型").tag(String?.none)
                        ForEach(availableModels) { item in
                            Text(item.model).tag(String?.some(item.model))
                        }
                    }
                }

                Spacer(minLength: 10)

                if state.isUsageRefreshing {
                    ProgressView()
                        .controlSize(.small)
                        .help("正在更新用量")
                }
                Text(
                    state.usage.capturedAt,
                    format: .dateTime.hour().minute().second()
                )
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(.tertiary)

                Button {
                    Task { await state.refreshUsageIfIdle() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .frame(width: 18, height: 18)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .disabled(state.isRefreshing || state.isUsageRefreshing)
                .help("刷新用量")
                .accessibilityLabel("刷新用量")
            }

            HStack(spacing: 12) {
                Picker(
                    "周期",
                    selection: Binding(
                        get: { state.usagePeriod },
                        set: { state.selectUsagePeriod($0) }
                    )
                ) {
                    ForEach(UsagePeriod.allCases) { period in
                        Text(period.title).tag(period)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(width: 330)

                Spacer(minLength: 8)

                DatePicker(
                    "开始",
                    selection: Binding(
                        get: { state.usageStartDate },
                        set: { state.setUsageStartDate($0) }
                    ),
                    displayedComponents: .date
                )
                .datePickerStyle(.compact)
                .controlSize(.large)
                .frame(width: 178)

                Image(systemName: "arrow.right")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)

                DatePicker(
                    "结束",
                    selection: Binding(
                        get: { state.usageEndDate },
                        set: { state.setUsageEndDate($0) }
                    ),
                    displayedComponents: .date
                )
                .datePickerStyle(.compact)
                .controlSize(.large)
                .frame(width: 178)
            }
        }
    }

    private func filterPicker<Content: View>(
        title: String,
        systemImage: String,
        width: CGFloat,
        @ViewBuilder content: () -> Content
    ) -> some View {
        HStack(spacing: 7) {
            Image(systemName: systemImage)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.secondary)
            content()
                .labelsHidden()
                .frame(maxWidth: .infinity)
        }
        .padding(.horizontal, 10)
        .frame(width: width, height: 36)
        .background(OpenUsageColors.faintFill)
        .overlay {
            RoundedRectangle(cornerRadius: 7, style: .continuous)
                .stroke(OpenUsageColors.separator, lineWidth: 1)
        }
        .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(title)
    }

    private var summary: some View {
        PanelSurface {
            VStack(alignment: .leading, spacing: 20) {
                HStack(alignment: .center, spacing: 16) {
                    Image(systemName: "bolt.fill")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(OpenUsageColors.blue)
                        .frame(width: 52, height: 52)
                        .background(OpenUsageColors.blue.opacity(0.12))
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

                    VStack(alignment: .leading, spacing: 5) {
                        Text(selectedModelSummary == nil ? "真实消耗 Tokens" : "模型消耗 Tokens")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(.secondary)
                        Text(headlineTokens.formatted())
                            .font(.system(size: 34, weight: .semibold, design: .rounded))
                            .contentTransition(.numericText())
                            .lineLimit(1)
                            .minimumScaleFactor(0.72)
                        Text(selectedModelSummary?.model ?? rangeTitle)
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(.tertiary)
                            .lineLimit(1)
                    }

                    Spacer(minLength: 20)

                    HStack(spacing: 18) {
                        inlineStat(
                            title: "请求数",
                            value: selectedBreakdown.requestCount.formatted(),
                            systemImage: "waveform.path.ecg",
                            tint: OpenUsageColors.blue
                        )
                        Divider()
                            .frame(height: 40)
                        inlineStat(
                            title: selectedModelSummary == nil
                                ? "本地已记录"
                                : "模型本地已记录",
                            value: DisplayFormat.credits(headlineCredits),
                            systemImage: "bolt.circle",
                            tint: OpenUsageColors.mint
                        )
                        if let quota = relevantQuota {
                            Divider()
                                .frame(height: 40)
                            inlineStat(
                                title: "当前账号周期已用",
                                value: DisplayFormat.credits(quota.used),
                                systemImage: "gauge.with.dots.needle.67percent",
                                tint: OpenUsageColors.coral
                            )
                        }
                    }
                }

                Divider()

                LazyVGrid(
                    columns: Array(repeating: GridItem(.flexible(), spacing: 20), count: 4),
                    alignment: .leading,
                    spacing: 16
                ) {
                    breakdownMetric(
                        title: "净输入",
                        value: DisplayFormat.tokens(selectedBreakdown.input),
                        detail: "不含缓存读写",
                        systemImage: "arrow.down",
                        tint: OpenUsageColors.blue
                    )
                    breakdownMetric(
                        title: "输出",
                        value: DisplayFormat.tokens(selectedBreakdown.output),
                        detail: selectedBreakdown.reasoning > 0
                            ? "含 \(DisplayFormat.tokens(selectedBreakdown.reasoning)) 推理"
                            : "生成 Token",
                        systemImage: "arrow.up",
                        tint: OpenUsageColors.violet
                    )
                    breakdownMetric(
                        title: "缓存创建",
                        value: DisplayFormat.tokens(selectedBreakdown.cacheWrite),
                        detail: "写入可复用上下文",
                        systemImage: "externaldrive.badge.plus",
                        tint: OpenUsageColors.coral
                    )
                    breakdownMetric(
                        title: "缓存命中",
                        value: DisplayFormat.tokens(selectedBreakdown.cacheRead),
                        detail: "复用输入上下文",
                        systemImage: "sparkles",
                        tint: OpenUsageColors.mint
                    )
                }

                Divider()

                VStack(alignment: .leading, spacing: 9) {
                    HStack {
                        Text("缓存命中率")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(.secondary)
                        Spacer()
                        Text(cacheHitRate, format: .percent.precision(.fractionLength(1)))
                            .font(.system(size: 12, weight: .semibold, design: .rounded))
                            .foregroundStyle(OpenUsageColors.mint)
                    }
                    GeometryReader { proxy in
                        ZStack(alignment: .leading) {
                            Capsule()
                                .fill(Color.primary.opacity(0.07))
                            Capsule()
                                .fill(OpenUsageColors.mint)
                                .frame(width: proxy.size.width * cacheHitRate)
                        }
                    }
                    .frame(height: 7)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("缓存命中率")
                    .accessibilityValue(
                        cacheHitRate.formatted(.percent.precision(.fractionLength(1)))
                    )
                }

                if let quota = relevantQuota {
                    Divider()
                    creditReconciliation(quota)
                }
            }
        }
    }

    private func inlineStat(
        title: String,
        value: String,
        systemImage: String,
        tint: Color
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(title, systemImage: systemImage)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.system(size: 19, weight: .semibold, design: .rounded))
                .foregroundStyle(tint)
                .contentTransition(.numericText())
                .lineLimit(1)
                .minimumScaleFactor(0.72)
        }
        .frame(minWidth: 84, alignment: .leading)
    }

    private func creditReconciliation(_ quota: QuotaSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 12) {
                Label("Credits 对账", systemImage: "info.circle")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                if let local = state.locallyAttributedCycleCredits {
                    Text("当前账号本地可归因 \(DisplayFormat.credits(local))")
                }
                if let unattributedCycleCredits {
                    Text("未归因 \(DisplayFormat.credits(unattributedCycleCredits))")
                        .foregroundStyle(OpenUsageColors.coral)
                }
                Text("当前账号服务端 \(DisplayFormat.credits(quota.used))")
                    .foregroundStyle(OpenUsageColors.mint)
            }
            .font(.system(size: 11, weight: .medium, design: .rounded))

            Text(
                "上方 Token 与本地 Credits 按当前筛选；WorkBuddy 服务端只返回当前登录账号的周期总额，不提供模型账单。模型 Credits 仅统计本地带 usage 的记录，可能低于实际消耗。"
            )
                .font(.system(size: 10))
                .foregroundStyle(.tertiary)
        }
        .accessibilityElement(children: .combine)
    }

    private func breakdownMetric(
        title: String,
        value: String,
        detail: String,
        systemImage: String,
        tint: Color
    ) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Label(title, systemImage: systemImage)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.secondary)
                .symbolRenderingMode(.monochrome)
                .tint(tint)
            Text(value)
                .font(.system(size: 19, weight: .semibold, design: .rounded))
                .contentTransition(.numericText())
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Text(detail)
                .font(.system(size: 10))
                .foregroundStyle(.tertiary)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var trend: some View {
        PanelSurface {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("使用趋势")
                            .font(.system(size: 16, weight: .semibold))
                        Text(
                            selectedModelSummary == nil
                                ? "全部模型的\(usesHourlyTrend ? "每小时" : "每日") Token 构成"
                                : "\(selectedModelSummary?.model ?? "") 的\(usesHourlyTrend ? "每小时" : "每日") Token 构成"
                        )
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                    }
                    Spacer()
                    trendLegend
                    Text(rangeTitle)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(.secondary)
                        .padding(.leading, 12)
                }

                if trendPoints.isEmpty {
                    EmptyStateView(
                        systemImage: "chart.line.uptrend.xyaxis",
                        title: state.usageMessage == nil ? "暂无数据" : "无法读取用量",
                        message: state.usageMessage ?? "当前筛选范围没有 Token 记录。"
                    )
                    .frame(height: 220)
                } else {
                    Chart(trendPoints) { point in
                        AreaMark(
                            x: .value(
                                "日期",
                                point.day,
                                unit: usesHourlyTrend ? .hour : .day
                            ),
                            y: .value("缓存命中", Double(point.tokens.cacheRead))
                        )
                        .foregroundStyle(
                            LinearGradient(
                                colors: [
                                    OpenUsageColors.violet.opacity(0.24),
                                    OpenUsageColors.violet.opacity(0.01)
                                ],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )
                        LineMark(
                            x: .value(
                                "日期",
                                point.day,
                                unit: usesHourlyTrend ? .hour : .day
                            ),
                            y: .value("Token", Double(point.tokens.input)),
                            series: .value("指标", "输入")
                        )
                        .foregroundStyle(OpenUsageColors.blue)
                        .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round))
                        .interpolationMethod(.catmullRom)
                        LineMark(
                            x: .value(
                                "日期",
                                point.day,
                                unit: usesHourlyTrend ? .hour : .day
                            ),
                            y: .value("Token", Double(point.tokens.output)),
                            series: .value("指标", "输出")
                        )
                        .foregroundStyle(OpenUsageColors.mint)
                        .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round))
                        .interpolationMethod(.catmullRom)
                        LineMark(
                            x: .value(
                                "日期",
                                point.day,
                                unit: usesHourlyTrend ? .hour : .day
                            ),
                            y: .value("Token", Double(point.tokens.cacheWrite)),
                            series: .value("指标", "缓存创建")
                        )
                        .foregroundStyle(OpenUsageColors.coral)
                        .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round))
                        .interpolationMethod(.catmullRom)
                        LineMark(
                            x: .value(
                                "日期",
                                point.day,
                                unit: usesHourlyTrend ? .hour : .day
                            ),
                            y: .value("Token", Double(point.tokens.cacheRead)),
                            series: .value("指标", "缓存命中")
                        )
                        .foregroundStyle(OpenUsageColors.violet)
                        .lineStyle(StrokeStyle(lineWidth: 2.5, lineCap: .round))
                        .interpolationMethod(.catmullRom)
                    }
                    .chartXAxis {
                        AxisMarks(values: axisDates) { value in
                            AxisGridLine().foregroundStyle(Color.primary.opacity(0.04))
                            AxisValueLabel {
                                if let date = value.as(Date.self) {
                                    if usesHourlyTrend {
                                        Text(date, format: .dateTime.hour())
                                    } else {
                                        Text(date, format: .dateTime.month().day())
                                    }
                                }
                            }
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
                    .frame(height: 250)
                }
            }
        }
    }

    private var axisDates: [Date] {
        let dates = trendPoints.map(\.day)
        let maxCount = 7
        guard maxCount > 1, dates.count > maxCount else {
            return dates
        }

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

    private var trendLegend: some View {
        HStack(spacing: 10) {
            legendItem("输入", color: OpenUsageColors.blue)
            legendItem("输出", color: OpenUsageColors.mint)
            legendItem("缓存创建", color: OpenUsageColors.coral)
            legendItem("缓存命中", color: OpenUsageColors.violet)
        }
    }

    private func legendItem(_ title: String, color: Color) -> some View {
        HStack(spacing: 4) {
            Circle()
                .fill(color)
                .frame(width: 6, height: 6)
            Text(title)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(.secondary)
        }
    }

    private var detail: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Picker("统计明细", selection: $detailTab) {
                    ForEach(DetailTab.allCases) { tab in
                        Label(tab.title, systemImage: tab.systemImage)
                            .tag(tab)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(width: 260)
                Spacer()
                Text(detailTab == .sessions ? "按 Token 排序的对话" : "按 Token 排序的模型")
                    .font(.system(size: 11))
                    .foregroundStyle(.tertiary)
            }

            PanelSurface {
                if detailTab == .sessions {
                    sessionDetail
                } else {
                    modelDetail
                }
            }
        }
    }

    @ViewBuilder
    private var sessionDetail: some View {
        if state.usage.sessions.isEmpty {
            EmptyStateView(
                systemImage: "bubble.left.and.bubble.right",
                title: "暂无对话用量",
                message: "当前账号与周期没有可展示的对话记录。"
            )
            .frame(height: 150)
        } else {
            VStack(spacing: 0) {
                detailHeader(firstColumn: "对话", secondColumn: "Token")
                Divider()
                ForEach(
                    Array(state.usage.sessions.prefix(20).enumerated()),
                    id: \.element.id
                ) { entry in
                    let index = entry.offset
                    let item = entry.element
                    usageRow(
                        rank: index + 1,
                        title: item.title,
                        subtitle: String(item.sessionID.prefix(10)),
                        tokens: item.tokens.total,
                        credits: item.credits
                    )
                }
            }
        }
    }

    @ViewBuilder
    private var modelDetail: some View {
        if visibleModels.isEmpty {
            EmptyStateView(
                systemImage: "cpu",
                title: "暂无模型用量",
                message: "当前筛选范围没有识别到模型 Token 记录。"
            )
            .frame(height: 150)
        } else {
            VStack(spacing: 0) {
                detailHeader(firstColumn: "模型", secondColumn: "Token")
                Divider()
                ForEach(
                    Array(visibleModels.prefix(20).enumerated()),
                    id: \.element.id
                ) { entry in
                    let index = entry.offset
                    let item = entry.element
                    usageRow(
                        rank: index + 1,
                        title: item.model,
                        subtitle: "模型",
                        tokens: item.tokens.total,
                        credits: item.credits
                    )
                }
            }
        }
    }

    private func detailHeader(firstColumn: String, secondColumn: String) -> some View {
        HStack(spacing: 12) {
            Text("#")
                .frame(width: 22, alignment: .leading)
            Text(firstColumn)
            Spacer()
            Text(secondColumn)
                .frame(width: 90, alignment: .trailing)
            Text("已记录 Credits")
                .frame(width: 94, alignment: .trailing)
        }
        .font(.system(size: 10, weight: .semibold))
        .foregroundStyle(.tertiary)
        .padding(.bottom, 10)
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
                .frame(width: 22, alignment: .leading)
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
                .frame(width: 94, alignment: .trailing)
        }
        .padding(.vertical, 10)
        .overlay(alignment: .bottom) {
            Divider()
                .opacity(rank == min(20, detailTab == .sessions
                    ? state.usage.sessions.count
                    : visibleModels.count) ? 0 : 1)
        }
    }
}
