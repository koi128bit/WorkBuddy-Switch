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
    @Published var usageAccountID: String?
    @Published var alert: AppAlert?

    let accounts = AccountStore()
    private let sessionStore = SessionStore()
    private let usageService = UsageService()
    private let workBuddy = WorkBuddyController()
    private var hasStarted = false
    private var autoRefreshTask: Task<Void, Never>?
    private var refreshGeneration: UInt64 = 0
    private var usageGeneration: UInt64 = 0

    init() {
        let today = Calendar.current.startOfDay(for: Date())
        usageStartDate = today
        usageEndDate = today
    }

    deinit {
        autoRefreshTask?.cancel()
    }

    var usageDateRange: UsageDateRange {
        usagePeriod.dateRange(
            customStart: usageStartDate,
            customEnd: usageEndDate
        )
    }

    func start() async {
        guard !hasStarted else { return }
        hasStarted = true
        if UserDefaults.standard.bool(forKey: "autoCaptureCurrentAccount") {
            _ = try? accounts.captureCurrent()
        }
        await refreshAll()
        autoRefreshTask = Task { [weak self] in
            await self?.autoRefreshLoop()
        }
    }

    func refreshAll(force: Bool = false) async {
        refreshGeneration &+= 1
        usageGeneration &+= 1
        let generation = refreshGeneration
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
            guard refreshGeneration == generation else { return }
            sessions = loadedSessions
            sessionMessage = nil
        } catch {
            guard refreshGeneration == generation else { return }
            sessions = []
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
                usage = .empty
                usageMessage = error.localizedDescription
                present(error, title: "用量读取失败")
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
        session.userID == accounts.currentUserID || accounts.hasSnapshot(for: session.userID)
    }

    func resume(_ session: SessionRecord) async {
        var preparation: ResumePreparation?
        do {
            preparation = try await prepareToResume(session)
            try await workBuddy.openSession(session.id)
            if let preparation, preparation.changedLocalState {
                await refreshAll(force: true)
            }
        } catch {
            if let preparation, preparation.changedLocalState {
                await refreshAll(force: true)
            }
            present(error, title: "无法恢复对话")
        }
    }

    func openInTerminal(_ session: SessionRecord) async {
        var preparation: ResumePreparation?
        do {
            preparation = try await prepareToResume(session)
            try workBuddy.openSessionInTerminal(session)
            if let preparation, preparation.changedLocalState {
                await refreshAll(force: true)
            }
        } catch {
            if let preparation, preparation.changedLocalState {
                await refreshAll(force: true)
            }
            present(error, title: "无法在终端恢复")
        }
    }

    func present(_ error: Error, title: String) {
        alert = AppAlert(title: title, message: error.localizedDescription)
    }

    private struct ResumePreparation {
        let switchedAccount: Bool
        let restoredFromTrash: Bool

        var changedLocalState: Bool { switchedAccount || restoredFromTrash }
    }

    private func prepareToResume(_ session: SessionRecord) async throws -> ResumePreparation {
        accounts.refreshCurrentAccount()
        let needsAccountSwitch = session.userID != accounts.currentUserID
        if needsAccountSwitch || session.isDeleted {
            invalidateRefreshResults()
        }

        var switchedAccount = false
        if needsAccountSwitch {
            guard let profile = accounts.accounts.first(where: { $0.id == session.userID }) else {
                throw OpenUsageError.accountSnapshotMissing
            }
            try await accounts.switchAccount(to: profile)
            usageAccountID = profile.id
            quota = nil
            locallyAttributedCycleCredits = nil
            quotaMessage = "正在刷新新账号额度。"
            switchedAccount = true
            try await Task.sleep(nanoseconds: 700_000_000)
        }

        var restoredFromTrash = false
        if session.isDeleted {
            let store = sessionStore
            do {
                try await Task.detached(priority: .userInitiated) {
                    try store.restoreFromTrash(
                        session.id,
                        expectedUserID: session.userID
                    )
                }.value
                restoredFromTrash = true
            } catch {
                await reloadSessions()
                if switchedAccount {
                    Task { await refreshAll(force: true) }
                }
                throw error
            }
        }

        return ResumePreparation(
            switchedAccount: switchedAccount,
            restoredFromTrash: restoredFromTrash
        )
    }

    private func reloadSessions() async {
        do {
            let store = sessionStore
            sessions = try await Task.detached(priority: .utility) {
                try store.loadSessions(includeDeleted: true)
            }.value
            sessionMessage = nil
        } catch {
            sessions = []
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
