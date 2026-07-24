import Foundation

struct SessionUsageMetadata: Sendable {
    let accountBySession: [String: String]
    let titlesBySession: [String: String]

    static let empty = SessionUsageMetadata(accountBySession: [:], titlesBySession: [:])
}

struct SessionResumeMutation: Sendable {
    let reassignedToCurrentAccount: Bool
    let restoredFromTrash: Bool
    let backupURL: URL?

    var changedLocalState: Bool {
        reassignedToCurrentAccount || restoredFromTrash
    }
}

struct SessionStore: Sendable {
    private let databaseURL: URL
    private let backupDirectoryURL: URL

    init(
        databaseURL: URL = AppPaths.workBuddyDatabase,
        backupDirectoryURL: URL = AppPaths.workBuddyMigrationBackups
    ) {
        self.databaseURL = databaseURL
        self.backupDirectoryURL = backupDirectoryURL
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

    func prepareSessionForResume(
        sessionID: String,
        expectedSourceUserID: String,
        targetUserID: String,
        restoreFromTrash: Bool
    ) throws -> SessionResumeMutation {
        guard
            !sessionID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            !expectedSourceUserID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            !targetUserID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            throw OpenUsageError.sessionRestoreConflict
        }
        guard FileManager.default.fileExists(atPath: databaseURL.path) else {
            throw OpenUsageError.databaseUnavailable
        }

        let initialState = try resumeState(sessionID: sessionID)
        guard initialState.userID == expectedSourceUserID else {
            throw OpenUsageError.sessionRestoreConflict
        }
        if restoreFromTrash {
            guard initialState.supportsTrash else {
                throw OpenUsageError.commandFailed("当前 WorkBuddy 版本不支持会话回收站。")
            }
            guard initialState.isDeleted else {
                throw OpenUsageError.sessionRestoreConflict
            }
        } else if initialState.isDeleted {
            throw OpenUsageError.sessionRestoreConflict
        }

        let shouldReassign = expectedSourceUserID != targetUserID
        guard shouldReassign || restoreFromTrash else {
            return SessionResumeMutation(
                reassignedToCurrentAccount: false,
                restoredFromTrash: false,
                backupURL: nil
            )
        }

        let backupURL = try createBackup()
        do {
            try performResumeMutation(
                sessionID: sessionID,
                expectedSourceUserID: expectedSourceUserID,
                targetUserID: targetUserID,
                shouldReassign: shouldReassign,
                restoreFromTrash: restoreFromTrash
            )
        } catch let committedError as PostCommitMutationError {
            do {
                try restoreDatabase(from: backupURL)
            } catch {
                throw OpenUsageError.commandFailed(
                    """
                    对话迁移失败：\(committedError.localizedDescription)
                    数据库自动恢复失败：\(error.localizedDescription)
                    安全备份保留在 \(backupURL.path)
                    """
                )
            }
            throw committedError.underlying
        }
        pruneBackups(keepingNewest: 5)

        return SessionResumeMutation(
            reassignedToCurrentAccount: shouldReassign,
            restoredFromTrash: restoreFromTrash,
            backupURL: backupURL
        )
    }

    private func sessionColumns(_ database: SQLiteDatabase) throws -> Set<String> {
        let rows = try database.query("PRAGMA table_info(sessions)")
        return Set(rows.compactMap { $0["name"]?.string })
    }

    private struct ResumeState {
        let userID: String
        let isDeleted: Bool
        let supportsTrash: Bool
    }

    private struct PostCommitMutationError: LocalizedError {
        let underlying: Error

        var errorDescription: String? {
            underlying.localizedDescription
        }
    }

    private func resumeState(sessionID: String) throws -> ResumeState {
        let database = try SQLiteDatabase(url: databaseURL, readOnly: true)
        return try resumeState(sessionID: sessionID, database: database)
    }

    private func resumeState(
        sessionID: String,
        database: SQLiteDatabase
    ) throws -> ResumeState {
        let columns = try sessionColumns(database)
        let supportsTrash = columns.contains("deleted_at")
        let deletedExpression = supportsTrash ? "deleted_at" : "NULL"
        let rows = try database.query(
            """
            SELECT user_id, \(deletedExpression) AS deleted_at
            FROM sessions
            WHERE id = ?
            """,
            bindings: [.text(sessionID)]
        )
        guard let row = rows.first, let userID = row["user_id"]?.string else {
            throw OpenUsageError.sessionNotFound
        }
        return ResumeState(
            userID: userID,
            isDeleted: row["deleted_at"] != .null,
            supportsTrash: supportsTrash
        )
    }

    private func createBackup() throws -> URL {
        let fileManager = FileManager.default
        try fileManager.createDirectory(
            at: backupDirectoryURL,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        try fileManager.setAttributes(
            [.posixPermissions: 0o700],
            ofItemAtPath: backupDirectoryURL.path
        )

        let timestamp = Int64(Date().timeIntervalSince1970 * 1_000)
        let backupURL = backupDirectoryURL
            .appendingPathComponent("workbuddy-\(timestamp)-\(UUID().uuidString).db")
        do {
            let database = try SQLiteDatabase(url: databaseURL, readOnly: false)
            try database.checkpointWAL()
            try database.backup(to: backupURL)
            do {
                let backupDatabase = try SQLiteDatabase(url: backupURL, readOnly: false)
                _ = try backupDatabase.query("PRAGMA journal_mode = DELETE")
            }
            for suffix in ["-wal", "-shm"] {
                let sidecar = URL(fileURLWithPath: backupURL.path + suffix)
                if fileManager.fileExists(atPath: sidecar.path) {
                    try fileManager.removeItem(at: sidecar)
                }
            }
            try fileManager.setAttributes(
                [.posixPermissions: 0o600],
                ofItemAtPath: backupURL.path
            )
            return backupURL
        } catch {
            try? fileManager.removeItem(at: backupURL)
            throw OpenUsageError.commandFailed(
                "无法创建迁移前数据库备份：\(error.localizedDescription)"
            )
        }
    }

    private func performResumeMutation(
        sessionID: String,
        expectedSourceUserID: String,
        targetUserID: String,
        shouldReassign: Bool,
        restoreFromTrash: Bool
    ) throws {
        let database: SQLiteDatabase
        do {
            database = try SQLiteDatabase(url: databaseURL, readOnly: false)
        } catch {
            throw OpenUsageError.commandFailed(
                "无法打开 WorkBuddy 会话数据库进行迁移：\(error.localizedDescription)"
            )
        }
        let columns: Set<String>
        do {
            columns = try sessionColumns(database)
        } catch {
            throw OpenUsageError.commandFailed(
                "无法读取 WorkBuddy 会话数据库结构：\(error.localizedDescription)"
            )
        }
        guard columns.contains("id"), columns.contains("user_id") else {
            throw OpenUsageError.commandFailed("WorkBuddy 会话数据库结构无法识别。")
        }
        if restoreFromTrash, !columns.contains("deleted_at") {
            throw OpenUsageError.commandFailed("当前 WorkBuddy 版本不支持会话回收站。")
        }

        var assignments: [String] = []
        var bindings: [SQLiteValue] = []
        if shouldReassign {
            assignments.append("user_id = ?")
            bindings.append(.text(targetUserID))
        }
        if restoreFromTrash {
            assignments.append("deleted_at = NULL")
            if columns.contains("updated_at") {
                assignments.append("updated_at = ?")
                bindings.append(.integer(Int64(Date().timeIntervalSince1970 * 1_000)))
            }
        }
        bindings.append(.text(sessionID))
        bindings.append(.text(expectedSourceUserID))

        var predicate = "id = ? AND user_id = ?"
        if columns.contains("deleted_at") {
            predicate += restoreFromTrash
                ? " AND deleted_at IS NOT NULL"
                : " AND deleted_at IS NULL"
        }

        do {
            try database.transaction {
                let changed = try database.execute(
                    """
                    UPDATE sessions
                    SET \(assignments.joined(separator: ", "))
                    WHERE \(predicate)
                    """,
                    bindings: bindings
                )
                guard changed == 1 else {
                    throw OpenUsageError.sessionRestoreConflict
                }

                let state = try resumeState(sessionID: sessionID, database: database)
                guard state.userID == targetUserID, !state.isDeleted else {
                    throw OpenUsageError.sessionRestoreConflict
                }
            }
        } catch OpenUsageError.sessionRestoreConflict {
            throw OpenUsageError.sessionRestoreConflict
        } catch {
            throw OpenUsageError.commandFailed(
                "WorkBuddy 会话迁移事务失败：\(error.localizedDescription)"
            )
        }

        do {
            do {
                try database.checkpointWAL()
            } catch {
                throw OpenUsageError.commandFailed(
                    "迁移提交后的 WAL 检查点失败：\(error.localizedDescription)"
                )
            }
            let finalState = try resumeState(sessionID: sessionID, database: database)
            guard finalState.userID == targetUserID, !finalState.isDeleted else {
                throw OpenUsageError.sessionRestoreConflict
            }
        } catch {
            throw PostCommitMutationError(underlying: error)
        }
    }

    private func restoreDatabase(from backupURL: URL) throws {
        let fileManager = FileManager.default
        let directory = databaseURL.deletingLastPathComponent()
        let temporaryURL = directory
            .appendingPathComponent(".workbuddy-switch-rollback-\(UUID().uuidString).db")
        try fileManager.copyItem(at: backupURL, to: temporaryURL)
        defer { try? fileManager.removeItem(at: temporaryURL) }

        for suffix in ["-wal", "-shm"] {
            let sidecar = URL(fileURLWithPath: databaseURL.path + suffix)
            if fileManager.fileExists(atPath: sidecar.path) {
                try fileManager.removeItem(at: sidecar)
            }
        }

        if fileManager.fileExists(atPath: databaseURL.path) {
            _ = try fileManager.replaceItemAt(
                databaseURL,
                withItemAt: temporaryURL,
                backupItemName: nil,
                options: []
            )
        } else {
            try fileManager.moveItem(at: temporaryURL, to: databaseURL)
        }
        try fileManager.setAttributes(
            [.posixPermissions: 0o600],
            ofItemAtPath: databaseURL.path
        )
    }

    private func pruneBackups(keepingNewest limit: Int) {
        guard limit > 0 else { return }
        let keys: [URLResourceKey] = [.contentModificationDateKey, .isRegularFileKey]
        guard let files = try? FileManager.default.contentsOfDirectory(
            at: backupDirectoryURL,
            includingPropertiesForKeys: keys,
            options: [.skipsHiddenFiles]
        ) else {
            return
        }
        let backups = files.filter {
            guard
                $0.lastPathComponent.hasPrefix("workbuddy-"),
                $0.pathExtension == "db",
                let values = try? $0.resourceValues(forKeys: Set(keys))
            else {
                return false
            }
            return values.isRegularFile == true
        }.sorted {
            let left = (try? $0.resourceValues(forKeys: Set(keys)).contentModificationDate)
                ?? .distantPast
            let right = (try? $1.resourceValues(forKeys: Set(keys)).contentModificationDate)
                ?? .distantPast
            return left > right
        }
        for url in backups.dropFirst(limit) {
            try? FileManager.default.removeItem(at: url)
        }
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
