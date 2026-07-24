import Foundation

struct SessionUsageMetadata: Sendable {
    let accountBySession: [String: String]
    let titlesBySession: [String: String]

    static let empty = SessionUsageMetadata(accountBySession: [:], titlesBySession: [:])
}

struct SessionStore: Sendable {
    private let databaseURL: URL

    init(databaseURL: URL = AppPaths.workBuddyDatabase) {
        self.databaseURL = databaseURL
    }

    func loadSessions(
        query: String = "",
        accountID: String? = nil,
        includeDeleted: Bool = false
    ) throws -> [SessionRecord] {
        guard FileManager.default.fileExists(atPath: databaseURL.path) else {
            throw OpenUsageError.databaseUnavailable
        }
        let database = try SQLiteDatabase(url: databaseURL, readOnly: true)
        let columns = try sessionColumns(database)
        var clauses: [String] = []
        var bindings: [SQLiteValue] = []

        if let accountID {
            clauses.append("user_id = ?")
            bindings.append(.text(accountID))
        }
        if !includeDeleted, columns.contains("deleted_at") {
            clauses.append("deleted_at IS NULL")
        }
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            let titleSearch = columns.contains("custom_title")
                ? "COALESCE(custom_title, title, '')"
                : "COALESCE(title, '')"
            clauses.append("(\(titleSearch) LIKE ? OR cwd LIKE ?)")
            let pattern = "%\(trimmed)%"
            bindings.append(.text(pattern))
            bindings.append(.text(pattern))
        }
        let predicate = clauses.isEmpty ? "" : "WHERE " + clauses.joined(separator: " AND ")
        let titleExpression = columns.contains("custom_title")
            ? "COALESCE(custom_title, title, '未命名对话')"
            : "COALESCE(title, '未命名对话')"
        let updatedExpression = columns.contains("updated_at") ? "updated_at" : "created_at"
        let deletedExpression = columns.contains("deleted_at") ? "deleted_at" : "NULL"
        let modelExpression = columns.contains("model") ? "model" : "NULL"
        let projectExpression = columns.contains("project_id") ? "project_id" : "NULL"
        let orderExpression: String
        if columns.contains("last_activity_at") {
            orderExpression = "COALESCE(last_activity_at, \(updatedExpression), created_at)"
        } else {
            orderExpression = "COALESCE(\(updatedExpression), created_at)"
        }
        let rows = try database.query(
            """
            SELECT id, \(titleExpression) AS display_title,
                   user_id, cwd, status, created_at,
                   \(updatedExpression) AS updated_at,
                   \(deletedExpression) AS deleted_at,
                   \(modelExpression) AS model,
                   \(projectExpression) AS project_id
            FROM sessions
            \(predicate)
            ORDER BY \(orderExpression) DESC
            """,
            bindings: bindings
        )
        return rows.compactMap(Self.session(from:))
    }

    func userIDsBySession() throws -> [String: String] {
        try usageMetadata().accountBySession
    }

    func titlesBySession() throws -> [String: String] {
        try usageMetadata().titlesBySession
    }

    func usageMetadata() throws -> SessionUsageMetadata {
        guard FileManager.default.fileExists(atPath: databaseURL.path) else {
            return .empty
        }
        let database = try SQLiteDatabase(url: databaseURL, readOnly: true)
        let columns = try sessionColumns(database)
        let titleExpression = columns.contains("custom_title")
            ? "COALESCE(custom_title, title, '')"
            : "COALESCE(title, '')"
        let rows = try database.query(
            """
            SELECT id, user_id, \(titleExpression) AS display_title
            FROM sessions
            WHERE id IS NOT NULL
            """
        )
        let accountBySession: [String: String] = Dictionary(
            uniqueKeysWithValues: rows.compactMap { row -> (String, String)? in
                guard
                    let id = row["id"]?.string,
                    let userID = row["user_id"]?.string,
                    !userID.isEmpty
                else { return nil }
                return (id, userID)
            }
        )
        let titlesBySession: [String: String] = Dictionary(
            uniqueKeysWithValues: rows.compactMap { row -> (String, String)? in
                guard let id = row["id"]?.string else { return nil }
                return (id, row["display_title"]?.string ?? "")
            }
        )
        return SessionUsageMetadata(
            accountBySession: accountBySession,
            titlesBySession: titlesBySession
        )
    }

    func restoreFromTrash(_ sessionID: String, expectedUserID: String) throws {
        guard FileManager.default.fileExists(atPath: databaseURL.path) else {
            throw OpenUsageError.databaseUnavailable
        }
        let database = try SQLiteDatabase(url: databaseURL, readOnly: false)
        let columns = try sessionColumns(database)
        guard columns.contains("deleted_at") else {
            throw OpenUsageError.commandFailed("当前 WorkBuddy 版本不支持会话回收站。")
        }
        let updateTimestamp = columns.contains("updated_at")
            ? ", updated_at = ?"
            : ""
        let bindings: [SQLiteValue] = updateTimestamp.isEmpty
            ? [.text(sessionID), .text(expectedUserID)]
            : [
                .integer(Int64(Date().timeIntervalSince1970 * 1_000)),
                .text(sessionID),
                .text(expectedUserID)
            ]
        let changed = try database.transaction {
            try database.execute(
                """
                UPDATE sessions
                SET deleted_at = NULL\(updateTimestamp)
                WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL
                """,
                bindings: bindings
            )
        }
        guard changed == 1 else { throw OpenUsageError.sessionRestoreConflict }
    }

    private func sessionColumns(_ database: SQLiteDatabase) throws -> Set<String> {
        let rows = try database.query("PRAGMA table_info(sessions)")
        return Set(rows.compactMap { $0["name"]?.string })
    }

    private static func session(from row: [String: SQLiteValue]) -> SessionRecord? {
        guard
            let id = row["id"]?.string,
            let userID = row["user_id"]?.string
        else { return nil }
        return SessionRecord(
            id: id,
            title: row["display_title"]?.string ?? "未命名对话",
            userID: userID,
            workingDirectory: row["cwd"]?.string ?? "",
            status: row["status"]?.string ?? "unknown",
            createdAt: date(milliseconds: row["created_at"]?.int64),
            updatedAt: date(milliseconds: row["updated_at"]?.int64),
            deletedAt: row["deleted_at"]?.int64.map { date(milliseconds: $0) },
            model: row["model"]?.string,
            projectID: row["project_id"]?.string
        )
    }

    private static func date(milliseconds: Int64?) -> Date {
        guard let milliseconds else { return .distantPast }
        return Date(timeIntervalSince1970: Double(milliseconds) / 1_000)
    }
}
