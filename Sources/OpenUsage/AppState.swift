import Foundation

struct AppAlert: Identifiable {
    let id = UUID()
    let title: String
    let message: String
}

@MainActor
final class AppState: ObservableObject {
    @Published var selectedSection: AppSection = .overview
    @Published private(set) var sessions: [SessionRecord] = []
    @Published private(set) var usage: UsageSnapshot = .empty
    @Published private(set) var quota: QuotaSnapshot?
    @Published private(set) var locallyAttributedCycleCredits: Double?
    @Published private(set) var quotaMessage: String?
    @Published private(set) var sessionMessage: String?
    @Published private(set) var usageMessage: String?
    @Published private(set) var isRefreshing = false
    @Published private(set) var isUsageRefreshing = false
    @Published private(set) var usagePeriod: UsagePeriod = .today
    @Published private(set) var usageStartDate: Date
    @Published private(set) var usageEndDate: Date
    @Published private(set) var resumingSessionID: String?
    @Published var usageAccountID: String?
    @Published var alert: AppAlert?

    let accounts = AccountStore()
    private let sessionStore = SessionStore()
    private let usageService = UsageService()
    private let workBuddy = WorkBuddyController()
    private var startupTask: Task<Void, Never>?
    private var localRefreshTask: Task<Void, Never>?
    private var autoRefreshTask: Task<Void, Never>?
    private var refreshGeneration: UInt64 = 0
    private var sessionGeneration: UInt64 = 0
    private var usageGeneration: UInt64 = 0

    init() {
        let today = Calendar.current.startOfDay(for: Date())
        usageStartDate = today
        usageEndDate = today
    }

    deinit {
        startupTask?.cancel()
        localRefreshTask?.cancel()
        autoRefreshTask?.cancel()
    }

    var usageDateRange: UsageDateRange {
        usagePeriod.dateRange(
            customStart: usageStartDate,
            customEnd: usageEndDate
        )
    }

    func start() async {
        if let startupTask {
            await startupTask.value
            return
        }

        let task = Task { @MainActor [weak self] () -> Void in
            guard let self else { return }
            await self.performStartup()
        }
        startupTask = task
        await task.value
    }

    private func performStartup() async {
        if UserDefaults.standard.bool(forKey: "autoCaptureCurrentAccount") {
            _ = try? accounts.captureCurrent()
        }

        localRefreshTask = Task { @MainActor [weak self] in
            await self?.localRefreshLoop()
        }
        autoRefreshTask = Task { [weak self] in
            await self?.autoRefreshLoop()
        }

        await refreshAll()

        for delay in [300_000_000, 900_000_000, 1_800_000_000] as [UInt64] {
            guard sessions.isEmpty || usage.scannedFiles == 0 || usageMessage != nil else {
                break
            }
            do {
                try await Task.sleep(nanoseconds: delay)
            } catch {
                return
            }
            if sessions.isEmpty {
                await reloadSessions()
            }
            if usage.scannedFiles == 0 || usageMessage != nil {
                await refreshUsageIfIdle(force: true)
            }
        }
    }

    func refreshAll(force: Bool = false) async {
        refreshGeneration &+= 1
        sessionGeneration &+= 1
        usageGeneration &+= 1
        let generation = refreshGeneration
        let sessionRequest = sessionGeneration
        let usageRequest = usageGeneration
        let range = usageDateRange
        let accountID = usageAccountID
        isRefreshing = true
        defer {
            if refreshGeneration == generation {
                isRefreshing = false
            }
        }
        accounts.refreshCurrentAccount()
        if let quota, quota.sourceUserID != accounts.currentUserID {
            self.quota = nil
            locallyAttributedCycleCredits = nil
            quotaMessage = "账号已变更，正在刷新额度。"
        }

        do {
            let store = sessionStore
            let loadedSessions = try await Task.detached(priority: .utility) {
                try store.loadSessions(includeDeleted: true)
            }.value
            guard
                refreshGeneration == generation,
                sessionGeneration == sessionRequest
            else {
                return
            }
            sessions = loadedSessions
            sessionMessage = nil
        } catch {
            guard
                refreshGeneration == generation,
                sessionGeneration == sessionRequest
            else {
                return
            }
            sessionMessage = error.localizedDescription
        }

        do {
            let loadedUsage = try await usageService.scan(
                range: range,
                accountID: accountID,
                force: force
            )
            guard refreshGeneration == generation else { return }
            if usageGeneration == usageRequest {
                usage = loadedUsage
                usageMessage = nil
            }
        } catch is CancellationError {
            return
        } catch {
            guard refreshGeneration == generation else { return }
            if usageGeneration == usageRequest {
                usageMessage = error.localizedDescription
                if force {
                    present(error, title: "用量读取失败")
                }
            }
        }

        do {
            let loadedQuota = try await usageService.fetchQuota()
            guard refreshGeneration == generation else { return }
            accounts.refreshCurrentAccount()
            if loadedQuota.sourceUserID == accounts.currentUserID {
                quota = loadedQuota
                quotaMessage = nil
                let attributed = await localCycleCredits(for: loadedQuota)
                guard refreshGeneration == generation else { return }
                locallyAttributedCycleCredits = attributed
            } else {
                quota = nil
                locallyAttributedCycleCredits = nil
                quotaMessage = "账号已变更，旧额度结果已丢弃。"
            }
        } catch {
            guard refreshGeneration == generation else { return }
            quota = nil
            locallyAttributedCycleCredits = nil
            quotaMessage = error.localizedDescription
        }
    }

    func recalculateUsage() async {
        while isRefreshing || isUsageRefreshing {
            do {
                try await Task.sleep(nanoseconds: 50_000_000)
            } catch {
                return
            }
        }
        guard !Task.isCancelled else { return }

        usageGeneration &+= 1
        let request = usageGeneration
        let range = usageDateRange
        let accountID = usageAccountID
        do {
            let recalculated = try await usageService.aggregateCached(
                range: range,
                accountID: accountID
            )
            guard !Task.isCancelled, usageGeneration == request else { return }
            usage = recalculated
            usageMessage = nil
        } catch {
            guard !Task.isCancelled, usageGeneration == request else { return }
            usageMessage = error.localizedDescription
        }
    }

    func refreshUsageIfIdle(force: Bool = false) async {
        guard !isRefreshing, !isUsageRefreshing else { return }
        isUsageRefreshing = true
        usageGeneration &+= 1
        let request = usageGeneration
        let range = usageDateRange
        let accountID = usageAccountID
        defer { isUsageRefreshing = false }

        do {
            let refreshed = try await usageService.scan(
                range: range,
                accountID: accountID,
                force: force
            )
            guard !Task.isCancelled, usageGeneration == request else { return }
            usage = refreshed
            usageMessage = nil
            if let quota, quota.sourceUserID == accounts.currentUserID {
                let attributed = await localCycleCredits(for: quota)
                guard !Task.isCancelled, usageGeneration == request else { return }
                locallyAttributedCycleCredits = attributed
            }
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled, usageGeneration == request else { return }
            usageMessage = error.localizedDescription
        }
    }

    func selectUsagePeriod(_ period: UsagePeriod) {
        usagePeriod = period
        guard period != .all, period != .custom else { return }

        let calendar = Calendar.current
        let now = Date()
        let range = period.dateRange(
            customStart: usageStartDate,
            customEnd: usageEndDate,
            now: now,
            calendar: calendar
        )
        if let start = range.startInclusive {
            usageStartDate = start
        }
        if let end = range.endExclusive,
           let inclusiveEnd = calendar.date(byAdding: .day, value: -1, to: end) {
            usageEndDate = inclusiveEnd
        }
    }

    func setUsageStartDate(_ date: Date) {
        let day = Calendar.current.startOfDay(for: date)
        usageStartDate = day
        if usageEndDate < day {
            usageEndDate = day
        }
        usagePeriod = .custom
    }

    func setUsageEndDate(_ date: Date) {
        let day = Calendar.current.startOfDay(for: date)
        usageEndDate = day
        if usageStartDate > day {
            usageStartDate = day
        }
        usagePeriod = .custom
    }

    func captureCurrentAccount() {
        do {
            _ = try accounts.captureCurrent()
            alert = AppAlert(title: "账号已保存", message: "登录快照已安全存入 macOS 钥匙串。")
        } catch {
            present(error, title: "无法保存账号")
        }
    }

    func switchAccount(to profile: AccountProfile) async {
        guard resumingSessionID == nil else {
            alert = AppAlert(
                title: "正在准备对话",
                message: "对话迁移或恢复完成后再切换账号。"
            )
            return
        }
        invalidateRefreshResults()
        do {
            try await accounts.switchAccount(to: profile)
            usageAccountID = profile.id
            quota = nil
            locallyAttributedCycleCredits = nil
            quotaMessage = "正在刷新新账号额度。"
            try await Task.sleep(nanoseconds: 500_000_000)
            await refreshAll(force: true)
        } catch {
            present(error, title: "切换失败")
        }
    }

    func renameAccount(_ profile: AccountProfile, nickname: String) {
        do {
            try accounts.rename(profile, to: nickname)
        } catch {
            present(error, title: "重命名失败")
        }
    }

    func removeAccount(_ profile: AccountProfile) {
        do {
            try accounts.remove(profile)
            if usageAccountID == profile.id {
                usageAccountID = nil
                Task { await recalculateUsage() }
            }
        } catch {
            present(error, title: "移除失败")
        }
    }

    func canResume(_ session: SessionRecord) -> Bool {
        guard
            !accounts.isSwitching,
            resumingSessionID == nil,
            let currentUserID = accounts.currentUserID
        else {
            return false
        }
        return !currentUserID.isEmpty
    }

    func sessionNeedsMigration(_ session: SessionRecord) -> Bool {
        guard let currentUserID = accounts.currentUserID else { return false }
        return session.userID != currentUserID
    }

    func resumeActionTitle(_ session: SessionRecord) -> String {
        switch (sessionNeedsMigration(session), session.isDeleted) {
        case (true, true):
            return "恢复、迁移并继续"
        case (true, false):
            return "迁移并继续"
        case (false, true):
            return "恢复并打开"
        case (false, false):
            return "继续对话"
        }
    }

    func resume(_ session: SessionRecord) async {
        guard beginResuming(session) else { return }
        defer { finishResuming(session) }

        var preparation: ResumePreparation?
        do {
            preparation = try await prepareToResume(session)
            try verifyCurrentAccount(preparation?.targetUserID)
            try await workBuddy.openSession(session.id)
            if let preparation, preparation.changedLocalState {
                await refreshAll(force: true)
            }
        } catch {
            let presentedError = await relaunchWorkBuddyIfNeeded(
                after: preparation,
                originalError: error
            )
            if let preparation, preparation.changedLocalState {
                await refreshAll(force: true)
            }
            let title = preparation?.changedLocalState == true
                ? "迁移已完成，打开失败"
                : "无法恢复对话"
            present(presentedError, title: title)
        }
    }

    func openInTerminal(_ session: SessionRecord) async {
        guard beginResuming(session) else { return }
        defer { finishResuming(session) }

        var preparation: ResumePreparation?
        do {
            try workBuddy.validateTerminalResume(session)
            preparation = try await prepareToResume(session)
            try verifyCurrentAccount(preparation?.targetUserID)
            try workBuddy.openSessionInTerminal(session)
            if preparation?.stoppedRunningApplication == true {
                try await workBuddy.launch()
            }
            if let preparation, preparation.changedLocalState {
                await refreshAll(force: true)
            }
        } catch {
            let presentedError = await relaunchWorkBuddyIfNeeded(
                after: preparation,
                originalError: error
            )
            if let preparation, preparation.changedLocalState {
                await refreshAll(force: true)
            }
            present(presentedError, title: "无法在终端恢复")
        }
    }

    func present(_ error: Error, title: String) {
        alert = AppAlert(title: title, message: error.localizedDescription)
    }

    private struct ResumePreparation {
        let reassignedToCurrentAccount: Bool
        let restoredFromTrash: Bool
        let stoppedRunningApplication: Bool
        let targetUserID: String

        var changedLocalState: Bool {
            reassignedToCurrentAccount || restoredFromTrash
        }
    }

    private func prepareToResume(_ session: SessionRecord) async throws -> ResumePreparation {
        accounts.refreshCurrentAccount()
        guard
            let targetUserID = accounts.currentUserID,
            !targetUserID.isEmpty
        else {
            throw OpenUsageError.authenticationFileMissing
        }
        guard workBuddy.applicationURL != nil else {
            throw OpenUsageError.workBuddyNotInstalled
        }

        let needsMutation = session.userID != targetUserID || session.isDeleted
        guard needsMutation else {
            return ResumePreparation(
                reassignedToCurrentAccount: false,
                restoredFromTrash: false,
                stoppedRunningApplication: false,
                targetUserID: targetUserID
            )
        }

        invalidateRefreshResults()
        let wasRunning = workBuddy.isRunning
        do {
            try await workBuddy.stop()
            let verifiedUserID = try AuthDocument.loadActive().userID
            guard verifiedUserID == targetUserID else {
                accounts.refreshCurrentAccount()
                throw OpenUsageError.commandFailed(
                    "WorkBuddy 当前账号在准备恢复时发生变化，请重新选择对话。"
                )
            }

            let store = sessionStore
            let mutation = try await Task.detached(priority: .userInitiated) {
                try store.prepareSessionForResume(
                    sessionID: session.id,
                    expectedSourceUserID: session.userID,
                    targetUserID: targetUserID,
                    restoreFromTrash: session.isDeleted
                )
            }.value
            return ResumePreparation(
                reassignedToCurrentAccount: mutation.reassignedToCurrentAccount,
                restoredFromTrash: mutation.restoredFromTrash,
                stoppedRunningApplication: wasRunning,
                targetUserID: targetUserID
            )
        } catch {
            let preparationError = error
            await reloadSessions()
            if wasRunning {
                do {
                    try await workBuddy.launch()
                } catch {
                    throw OpenUsageError.commandFailed(
                        """
                        \(preparationError.localizedDescription)
                        WorkBuddy 重新启动失败：\(error.localizedDescription)
                        """
                    )
                }
            }
            throw preparationError
        }
    }

    private func beginResuming(_ session: SessionRecord) -> Bool {
        guard resumingSessionID == nil, !accounts.isSwitching else { return false }
        resumingSessionID = session.id
        return true
    }

    private func finishResuming(_ session: SessionRecord) {
        if resumingSessionID == session.id {
            resumingSessionID = nil
        }
    }

    private func verifyCurrentAccount(_ expectedUserID: String?) throws {
        guard let expectedUserID else { throw OpenUsageError.authenticationFileMissing }
        let currentUserID = try AuthDocument.loadActive().userID
        guard currentUserID == expectedUserID else {
            accounts.refreshCurrentAccount()
            throw OpenUsageError.commandFailed(
                "WorkBuddy 当前账号在打开对话前发生变化，已停止自动打开。"
            )
        }
    }

    private func relaunchWorkBuddyIfNeeded(
        after preparation: ResumePreparation?,
        originalError: Error
    ) async -> Error {
        guard
            preparation?.stoppedRunningApplication == true,
            !workBuddy.isRunning
        else {
            return originalError
        }
        do {
            try await workBuddy.launch()
            return originalError
        } catch {
            return OpenUsageError.commandFailed(
                """
                \(originalError.localizedDescription)
                WorkBuddy 重新启动失败：\(error.localizedDescription)
                """
            )
        }
    }

    private func reloadSessions() async {
        sessionGeneration &+= 1
        let request = sessionGeneration
        do {
            let store = sessionStore
            let loadedSessions = try await Task.detached(priority: .utility) {
                try store.loadSessions(includeDeleted: true)
            }.value
            guard sessionGeneration == request else { return }
            sessions = loadedSessions
            sessionMessage = nil
        } catch {
            guard sessionGeneration == request else { return }
            sessionMessage = error.localizedDescription
        }
    }

    private func invalidateRefreshResults() {
        refreshGeneration &+= 1
        usageGeneration &+= 1
        isRefreshing = false
    }

    private func localCycleCredits(for quota: QuotaSnapshot) async -> Double? {
        guard let cycleStartsAt = quota.cycleStartsAt else { return nil }
        let endExclusive = quota.resetsAt?.addingTimeInterval(1)
        let snapshot = try? await usageService.aggregateCached(
            range: UsageDateRange(
                startInclusive: cycleStartsAt,
                endExclusive: endExclusive
            ),
            accountID: quota.sourceUserID
        )
        return snapshot?.credits
    }

    private func localRefreshLoop() async {
        while !Task.isCancelled {
            do {
                try await Task.sleep(nanoseconds: 15_000_000_000)
            } catch {
                return
            }
            guard !Task.isCancelled else { return }
            guard
                !isRefreshing,
                !accounts.isSwitching,
                resumingSessionID == nil
            else {
                continue
            }
            await reloadSessions()
            await refreshUsageIfIdle()
        }
    }

    private func autoRefreshLoop() async {
        while !Task.isCancelled {
            let configured = UserDefaults.standard.integer(forKey: "refreshIntervalMinutes")
            let minutes = configured > 0 ? configured : 10
            try? await Task.sleep(nanoseconds: UInt64(minutes) * 60 * 1_000_000_000)
            if !Task.isCancelled {
                await refreshAll()
            }
        }
    }
}
