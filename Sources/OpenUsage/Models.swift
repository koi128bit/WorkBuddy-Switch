import Foundation

enum ManagedProvider: String, CaseIterable, Codable, Identifiable, Sendable {
    case workBuddy
    case traeCN
    case traeWork

    var id: String { rawValue }

    var title: String {
        switch self {
        case .workBuddy: return "WorkBuddy"
        case .traeCN: return "Trae CN"
        case .traeWork: return "TRAE Work"
        }
    }

    var systemImage: String {
        switch self {
        case .workBuddy: return "bolt.horizontal.circle"
        case .traeCN: return "sparkle"
        case .traeWork: return "briefcase"
        }
    }

    var supportsSessions: Bool {
        self == .workBuddy
    }
}

enum AppSection: String, CaseIterable, Identifiable, Sendable {
    case overview
    case accounts
    case sessions
    case usage
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .overview: return "概览"
        case .accounts: return "账号"
        case .sessions: return "对话"
        case .usage: return "用量"
        case .settings: return "设置"
        }
    }

    var systemImage: String {
        switch self {
        case .overview: return "sparkles"
        case .accounts: return "person.2"
        case .sessions: return "bubble.left.and.bubble.right"
        case .usage: return "chart.bar.xaxis"
        case .settings: return "gearshape"
        }
    }
}

struct AccountProfile: Codable, Identifiable, Hashable, Sendable {
    let id: String
    var nickname: String
    var accountType: String?
    var phoneHint: String?
    var capturedAt: Date
    var lastUsedAt: Date

    var shortID: String {
        guard id.count > 12 else { return id }
        return "\(id.prefix(7))...\(id.suffix(4))"
    }

    var initials: String {
        let trimmed = nickname.trimmingCharacters(in: .whitespacesAndNewlines)
        if let first = trimmed.first {
            return String(first).uppercased()
        }
        return String(id.prefix(1)).uppercased()
    }
}

struct SessionRecord: Identifiable, Hashable, Sendable {
    let id: String
    let title: String
    let userID: String
    let workingDirectory: String
    let status: String
    let createdAt: Date
    let updatedAt: Date
    let deletedAt: Date?
    let model: String?
    let projectID: String?

    var isDeleted: Bool { deletedAt != nil }

    var directoryName: String {
        guard !workingDirectory.isEmpty else { return "未知目录" }
        return URL(fileURLWithPath: workingDirectory).lastPathComponent
    }
}

struct TokenBreakdown: Codable, Hashable, Sendable {
    var input: Int = 0
    var output: Int = 0
    var cacheRead: Int = 0
    var cacheWrite: Int = 0
    var reasoning: Int = 0
    var requestCount: Int = 0

    var total: Int { input + output + cacheRead + cacheWrite }

    static func + (lhs: TokenBreakdown, rhs: TokenBreakdown) -> TokenBreakdown {
        TokenBreakdown(
            input: lhs.input + rhs.input,
            output: lhs.output + rhs.output,
            cacheRead: lhs.cacheRead + rhs.cacheRead,
            cacheWrite: lhs.cacheWrite + rhs.cacheWrite,
            reasoning: lhs.reasoning + rhs.reasoning,
            requestCount: lhs.requestCount + rhs.requestCount
        )
    }
}

/// Parsed transcript usage only. Account ownership is intentionally resolved
/// from the current sessions database each time usage is aggregated.
struct UsageMessage: Hashable, Sendable {
    let deduplicationKey: String
    let sessionID: String
    let timestamp: Date
    let model: String
    let tokens: TokenBreakdown
    let credits: Double
}

struct DailyUsagePoint: Identifiable, Hashable, Sendable {
    let day: Date
    let breakdown: TokenBreakdown
    let credits: Double

    var id: Date { day }
    var tokens: Int { breakdown.total }
}

struct HourlyUsagePoint: Identifiable, Hashable, Sendable {
    let hour: Date
    let breakdown: TokenBreakdown
    let credits: Double

    var id: Date { hour }
    var tokens: Int { breakdown.total }
}

struct ModelDailyUsagePoint: Identifiable, Hashable, Sendable {
    let day: Date
    let model: String
    let tokens: TokenBreakdown
    let credits: Double

    var id: String { "\(day.timeIntervalSinceReferenceDate):\(model)" }
}

struct ModelHourlyUsagePoint: Identifiable, Hashable, Sendable {
    let hour: Date
    let model: String
    let tokens: TokenBreakdown
    let credits: Double

    var id: String { "\(hour.timeIntervalSinceReferenceDate):\(model)" }
}

struct SessionUsageSummary: Identifiable, Hashable, Sendable {
    let sessionID: String
    let title: String
    let tokens: TokenBreakdown
    let credits: Double
    let lastActivity: Date

    var id: String { sessionID }
}

struct ModelUsageSummary: Identifiable, Hashable, Sendable {
    let model: String
    let tokens: TokenBreakdown
    let credits: Double

    var id: String { model }
}

struct UsageSnapshot: Hashable, Sendable {
    var total = TokenBreakdown()
    var credits: Double = 0
    var daily: [DailyUsagePoint] = []
    var hourly: [HourlyUsagePoint] = []
    var modelDaily: [ModelDailyUsagePoint] = []
    var modelHourly: [ModelHourlyUsagePoint] = []
    var sessions: [SessionUsageSummary] = []
    var models: [ModelUsageSummary] = []
    var scannedFiles: Int = 0
    var capturedAt = Date()

    static let empty = UsageSnapshot()
}

struct QuotaSnapshot: Hashable, Sendable {
    let sourceUserID: String
    let used: Double
    let total: Double
    let packageName: String?
    let cycleStartsAt: Date?
    let resetsAt: Date?
    let capturedAt: Date

    var remaining: Double { max(total - used, 0) }
    var usedFraction: Double { total > 0 ? min(max(used / total, 0), 1) : 0 }
}

struct UsageDateRange: Hashable, Sendable {
    let startInclusive: Date?
    let endExclusive: Date?

    func contains(_ date: Date) -> Bool {
        let isAfterStart = startInclusive.map { date >= $0 } ?? true
        let isBeforeEnd = endExclusive.map { date < $0 } ?? true
        return isAfterStart && isBeforeEnd
    }

    func spansSingleDay(calendar: Calendar = .current) -> Bool {
        guard
            let startInclusive,
            let endExclusive,
            endExclusive > startInclusive
        else {
            return false
        }
        let finalMoment = endExclusive.addingTimeInterval(-0.001)
        return calendar.isDate(startInclusive, inSameDayAs: finalMoment)
    }
}

enum UsagePeriod: String, CaseIterable, Identifiable, Sendable {
    case today
    case sevenDays
    case thirtyDays
    case all
    case custom

    var id: String { rawValue }

    var title: String {
        switch self {
        case .today: return "当天"
        case .sevenDays: return "7 天"
        case .thirtyDays: return "30 天"
        case .all: return "全部"
        case .custom: return "自定义"
        }
    }

    func dateRange(
        customStart: Date,
        customEnd: Date,
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> UsageDateRange {
        let today = calendar.startOfDay(for: now)
        let tomorrow = calendar.date(byAdding: .day, value: 1, to: today)
        switch self {
        case .today:
            return UsageDateRange(startInclusive: today, endExclusive: tomorrow)
        case .sevenDays:
            return UsageDateRange(
                startInclusive: calendar.date(byAdding: .day, value: -6, to: today),
                endExclusive: tomorrow
            )
        case .thirtyDays:
            return UsageDateRange(
                startInclusive: calendar.date(byAdding: .day, value: -29, to: today),
                endExclusive: tomorrow
            )
        case .all:
            return UsageDateRange(startInclusive: nil, endExclusive: nil)
        case .custom:
            let firstDay = calendar.startOfDay(for: min(customStart, customEnd))
            let lastDay = calendar.startOfDay(for: max(customStart, customEnd))
            return UsageDateRange(
                startInclusive: firstDay,
                endExclusive: calendar.date(byAdding: .day, value: 1, to: lastDay)
            )
        }
    }
}

enum OpenUsageError: LocalizedError, Sendable {
    case workBuddyNotInstalled
    case authenticationFileMissing
    case invalidAuthenticationFile
    case keychain(String)
    case accountSnapshotMissing
    case databaseUnavailable
    case sessionNotFound
    case sessionRestoreConflict
    case usageCacheUnavailable
    case commandFailed(String)
    case quotaUnavailable(String)

    var errorDescription: String? {
        switch self {
        case .workBuddyNotInstalled:
            return "未找到 WorkBuddy，请先安装并登录。"
        case .authenticationFileMissing:
            return "未找到 WorkBuddy 登录信息，请先在 WorkBuddy 中完成登录。"
        case .invalidAuthenticationFile:
            return "WorkBuddy 登录信息格式无法识别。"
        case .keychain(let message):
            return "钥匙串操作失败：\(message)"
        case .accountSnapshotMissing:
            return "该账号没有可用的安全快照，请重新登录并捕获一次。"
        case .databaseUnavailable:
            return "未找到或无法读取 WorkBuddy 会话数据库。"
        case .sessionNotFound:
            return "该对话已不存在。"
        case .sessionRestoreConflict:
            return "对话已变更、已恢复，或不属于预期账号；列表已重新加载。"
        case .usageCacheUnavailable:
            return "用量数据正在初始化。"
        case .commandFailed(let message):
            return message
        case .quotaUnavailable(let message):
            return message
        }
    }
}
