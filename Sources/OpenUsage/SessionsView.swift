import AppKit
import SwiftUI

struct SessionsView: View {
    @ObservedObject var state: AppState
    @ObservedObject private var accounts: AccountStore
    @State private var search = ""
    @State private var selectedAccount = ""
    @State private var includeTrash = false
    @State private var selection: String?

    init(state: AppState) {
        self.state = state
        _accounts = ObservedObject(wrappedValue: state.accounts)
    }

    private var filteredSessions: [SessionRecord] {
        state.sessions.filter { session in
            let matchesTrash = includeTrash || !session.isDeleted
            let matchesAccount = selectedAccount.isEmpty || session.userID == selectedAccount
            let needle = search.trimmingCharacters(in: .whitespacesAndNewlines)
            let matchesSearch = needle.isEmpty
                || session.title.localizedCaseInsensitiveContains(needle)
                || session.workingDirectory.localizedCaseInsensitiveContains(needle)
            return matchesTrash && matchesAccount && matchesSearch
        }
    }

    private var selectedSession: SessionRecord? {
        guard let selection else { return nil }
        return state.sessions.first { $0.id == selection }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                SectionTitle(
                    title: "对话",
                    subtitle: "\(filteredSessions.count) 个结果"
                )
                Spacer()
                Toggle("回收站", isOn: $includeTrash)
                    .toggleStyle(.switch)
                    .controlSize(.small)
            }
            .padding(.horizontal, 28)
            .frame(height: 82)

            Divider()

            HSplitView {
                sessionList
                    .frame(minWidth: 270, idealWidth: 300, maxWidth: 340)
                detail
                    .frame(minWidth: 400, maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .onAppear {
            if selection == nil {
                selection = filteredSessions.first?.id
            }
        }
        .onChange(of: filteredSessions) { sessions in
            if selection == nil || !sessions.contains(where: { $0.id == selection }) {
                selection = sessions.first?.id
            }
        }
    }

    private var sessionList: some View {
        VStack(spacing: 0) {
            VStack(spacing: 9) {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(.secondary)
                    TextField("搜索标题或目录", text: $search)
                        .textFieldStyle(.plain)
                }
                .padding(.horizontal, 10)
                .frame(height: 34)
                .background(Color.primary.opacity(0.045))
                .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))

                Picker("账号", selection: $selectedAccount) {
                    Text("全部账号").tag("")
                    ForEach(accounts.accounts) { account in
                        Text(account.nickname).tag(account.id)
                    }
                }
                .labelsHidden()
                .frame(maxWidth: .infinity)
            }
            .padding(12)

            Divider()

            if filteredSessions.isEmpty {
                EmptyStateView(
                    systemImage: "bubble.left.and.exclamationmark.bubble.right",
                    title: state.sessionMessage == nil ? "没有匹配的对话" : "无法读取对话",
                    message: state.sessionMessage ?? "调整搜索或账号筛选。"
                )
            } else {
                List(filteredSessions, selection: $selection) { session in
                    VStack(alignment: .leading, spacing: 5) {
                        HStack(spacing: 6) {
                            Text(session.title)
                                .font(.system(size: 12, weight: .semibold))
                                .lineLimit(1)
                            if session.isDeleted {
                                Image(systemName: "trash")
                                    .font(.system(size: 9))
                                    .foregroundStyle(.red)
                            }
                        }
                        Text(session.directoryName)
                            .font(.system(size: 10))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                        HStack {
                            Text(DisplayFormat.relativeDate(session.updatedAt))
                            Spacer()
                            Text(session.status)
                        }
                        .font(.system(size: 9, weight: .medium))
                        .foregroundStyle(.tertiary)
                    }
                    .padding(.vertical, 5)
                    .tag(session.id)
                    .contextMenu {
                        Button(state.resumeActionTitle(session)) {
                            Task { await state.resume(session) }
                        }
                        .disabled(!state.canResume(session))
                        Button(terminalActionTitle(session)) {
                            Task { await state.openInTerminal(session) }
                        }
                        .disabled(!state.canResume(session))
                    }
                }
                .listStyle(.sidebar)
            }
        }
        .background(Color(nsColor: .controlBackgroundColor).opacity(0.35))
    }

    @ViewBuilder
    private var detail: some View {
        if let session = selectedSession {
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    HStack(alignment: .top, spacing: 18) {
                        VStack(alignment: .leading, spacing: 7) {
                            Text(session.title)
                                .font(.system(size: 24, weight: .semibold))
                                .textSelection(.enabled)
                            Text(session.id)
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundStyle(.secondary)
                                .textSelection(.enabled)
                        }
                        Spacer()
                        Button {
                            Task { await state.openInTerminal(session) }
                        } label: {
                            Image(systemName: "terminal")
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.large)
                        .help(terminalActionTitle(session))
                        .accessibilityLabel(terminalActionTitle(session))
                        .disabled(!state.canResume(session))

                        Button {
                            Task { await state.resume(session) }
                        } label: {
                            if state.resumingSessionID == session.id {
                                Label("正在准备", systemImage: "clock")
                            } else {
                                Label(
                                    state.resumeActionTitle(session),
                                    systemImage: "arrow.up.forward.app"
                                )
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                        .disabled(!state.canResume(session))
                    }

                    if accounts.currentUserID == nil {
                        Label("请先在 WorkBuddy 登录要继续使用的账号", systemImage: "person.crop.circle.badge.exclamationmark")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(.orange)
                    } else if state.sessionNeedsMigration(session) {
                        VStack(alignment: .leading, spacing: 5) {
                            Label(
                                "继续后会将此对话迁移到当前账号，不会切换 WorkBuddy 登录账号。",
                                systemImage: "arrow.left.arrow.right"
                            )
                            Text("该对话的历史本地 Token 与 Credits 也会归入当前账号。")
                                .foregroundStyle(.secondary)
                        }
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(OpenUsageColors.blue)
                    }

                    Divider()

                    detailGrid(session)

                    if let usage = state.usage.sessions.first(where: { $0.sessionID == session.id }) {
                        VStack(alignment: .leading, spacing: 14) {
                            Text("Token 明细")
                                .font(.system(size: 16, weight: .semibold))
                            LazyVGrid(
                                columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 4),
                                spacing: 10
                            ) {
                                compactMetric("净输入", usage.tokens.input, OpenUsageColors.blue)
                                compactMetric("输出", usage.tokens.output, OpenUsageColors.coral)
                                compactMetric("缓存命中", usage.tokens.cacheRead, OpenUsageColors.lime)
                                compactMetric("思考", usage.tokens.reasoning, OpenUsageColors.cyan)
                            }
                        }
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        Text("工作目录")
                            .font(.system(size: 16, weight: .semibold))
                        HStack {
                            Image(systemName: "folder")
                                .foregroundStyle(.secondary)
                            Text(session.workingDirectory)
                                .font(.system(size: 12, design: .monospaced))
                                .textSelection(.enabled)
                            Spacer()
                            Button {
                                NSWorkspace.shared.selectFile(
                                    nil,
                                    inFileViewerRootedAtPath: session.workingDirectory
                                )
                            } label: {
                                Image(systemName: "arrow.right.circle")
                            }
                            .buttonStyle(.borderless)
                            .help("在访达中显示")
                            .accessibilityLabel("在访达中显示")
                        }
                        .padding(12)
                        .background(OpenUsageColors.faintFill)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    }
                }
                .padding(28)
            }
        } else {
            EmptyStateView(
                systemImage: "bubble.left.and.bubble.right",
                title: "选择一个对话",
                message: "查看详情并继续之前的工作。"
            )
        }
    }

    private func detailGrid(_ session: SessionRecord) -> some View {
        Grid(alignment: .leading, horizontalSpacing: 34, verticalSpacing: 14) {
            GridRow {
                detailLabel(state.sessionNeedsMigration(session) ? "原账号" : "账号")
                detailValue(
                    accounts.accounts.first { $0.id == session.userID }?.nickname
                        ?? String(session.userID.prefix(12))
                )
                detailLabel("状态")
                detailValue(session.isDeleted ? "回收站" : session.status)
            }
            GridRow {
                detailLabel("模型")
                detailValue(session.model ?? "auto")
                detailLabel("最近活动")
                detailValue(session.updatedAt.formatted(date: .abbreviated, time: .shortened))
            }
            GridRow {
                detailLabel("创建时间")
                detailValue(session.createdAt.formatted(date: .abbreviated, time: .shortened))
                detailLabel("项目")
                detailValue(session.projectID ?? session.directoryName)
            }
        }
    }

    private func detailLabel(_ value: String) -> some View {
        Text(value)
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(.secondary)
    }

    private func detailValue(_ value: String) -> some View {
        Text(value)
            .font(.system(size: 12, weight: .semibold))
            .lineLimit(1)
    }

    private func compactMetric(_ label: String, _ value: Int, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            RoundedRectangle(cornerRadius: 2)
                .fill(color)
                .frame(width: 22, height: 3)
            Text(DisplayFormat.tokens(value))
                .font(.system(size: 18, weight: .semibold, design: .rounded))
            Text(label)
                .font(.system(size: 10))
                .foregroundStyle(.secondary)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(OpenUsageColors.faintFill)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private func terminalActionTitle(_ session: SessionRecord) -> String {
        if state.sessionNeedsMigration(session) {
            return session.isDeleted ? "恢复、迁移并在终端继续" : "迁移并在终端继续"
        }
        return session.isDeleted ? "恢复并在终端继续" : "在终端继续"
    }
}
