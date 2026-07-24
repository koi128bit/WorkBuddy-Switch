import Foundation

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
    var reasoning: Int = 0

    var total: Int { input + output + cacheRead }

    static func + (lhs: TokenBreakdown, rhs: TokenBreakdown) -> TokenBreakdown {
        TokenBreakdown(
            input: lhs.input + rhs.input,
            output: lhs.output + rhs.output,
            cacheRead: lhs.cacheRead + rhs.cacheRead,
            reasoning: lhs.reasoning + rhs.reasoning
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
    let tokens: Int
    let credits: Double

    var id: Date { day }
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
    let tokens: Int
    let credits: Double

    var id: String { model }
}

struct UsageSnapshot: Hashable, Sendable {
    var total = TokenBreakdown()
    var credits: Double = 0
    var daily: [DailyUsagePoint] = []
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
    let resetsAt: Date?
    let capturedAt: Date

    var remaining: Double { max(total - used, 0) }
    var usedFraction: Double { total > 0 ? min(max(used / total, 0), 1) : 0 }
}

enum UsagePeriod: String, CaseIterable, Identifiable, Sendable {
    case sevenDays
    case thirtyDays
    case all

    var id: String { rawValue }

    var title: String {
        switch self {
        case .sevenDays: return "7 天"
        case .thirtyDays: return "30 天"
        case .all: return "全部"
        }
    }

    var startDate: Date? {
        let calendar = Calendar.current
        switch self {
        case .sevenDays:
            return calendar.date(byAdding: .day, value: -6, to: calendar.startOfDay(for: Date()))
        case .thirtyDays:
            return calendar.date(byAdding: .day, value: -29, to: calendar.startOfDay(for: Date()))
        case .all:
            return nil
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
        case .commandFailed(let message):
            return message
        case .quotaUnavailable(let message):
            return message
        }
    }
}
