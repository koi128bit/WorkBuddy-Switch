import Foundation

@main
enum OpenUsageSelfTest {
    static func main() async throws {
        var assertions = 0

        func expect(
            _ condition: @autoclosure () -> Bool,
            _ message: String,
            file: StaticString = #filePath,
            line: UInt = #line
        ) throws {
            assertions += 1
            guard condition() else {
                throw SelfTestFailure(message: message, file: "\(file)", line: line)
            }
        }

        let authData = Data(
            """
            {
              "account": {
                "uid": "user-123",
                "nickname": "Fixture",
                "accountType": "pro",
                "phoneNumber": "13800138000"
              },
              "auth": { "accessToken": "fixture-token" }
            }
            """.utf8
        )
        let document = try AuthDocument(data: authData)
        try expect(document.userID == "user-123", "auth uid")
        try expect(document.nickname == "Fixture", "auth nickname")
        try expect(document.phoneHint == "138****8000", "phone masking")
        let fixtureToken = try document.accessToken()
        try expect(fixtureToken == "fixture-token", "token extraction")

        let usageLine = Data(
            """
            {
              "type": "message",
              "role": "assistant",
              "sessionId": "session-1",
              "timestamp": 1784822400000,
              "providerData": {
                "model": "auto",
                "rawUsage": {
                  "prompt_tokens": 1200,
                  "completion_tokens": 300,
                  "prompt_cache_hit_tokens": 400,
                  "completion_thinking_tokens": 80,
                  "credit": 1.25
                }
              }
            }
            """.utf8
        )
        let parsedA = UsageParser.parseLine(
            usageLine,
            sourceFingerprint: "copy-a"
        )
        let parsedB = UsageParser.parseLine(
            usageLine,
            sourceFingerprint: "copy-b"
        )
        guard let message = parsedA.message else {
            throw SelfTestFailure(message: "usage message missing", file: #filePath, line: #line)
        }
        try expect(message.tokens.input == 800, "net input")
        try expect(message.tokens.output == 300, "output")
        try expect(message.tokens.cacheRead == 400, "cache hit")
        try expect(message.tokens.reasoning == 80, "reasoning")
        try expect(message.tokens.total == 1500, "total")
        try expect(message.credits == 1.25, "credits")
        try expect(
            parsedA.message?.deduplicationKey == parsedB.message?.deduplicationKey,
            "copied rows must deduplicate"
        )

        let snapshot = UsageParser.aggregate(
            messages: [message],
            titles: ["session-1": "Fixture session"],
            accountBySession: ["session-1": "account-1"],
            period: .all,
            accountID: "account-1"
        )
        try expect(snapshot.total.total == 1500, "aggregate total")
        try expect(snapshot.sessions.first?.title == "Fixture session", "session title")
        let movedAway = UsageParser.aggregate(
            messages: [message],
            titles: [:],
            accountBySession: ["session-1": "account-2"],
            period: .all,
            accountID: "account-1"
        )
        try expect(movedAway.total.total == 0, "latest session owner removes stale attribution")
        let movedTo = UsageParser.aggregate(
            messages: [message],
            titles: [:],
            accountBySession: ["session-1": "account-2"],
            period: .all,
            accountID: "account-2"
        )
        try expect(movedTo.total.total == 1500, "latest session owner receives attribution")
        let unattributed = UsageParser.aggregate(
            messages: [message],
            titles: [:],
            accountBySession: [:],
            period: .all,
            accountID: "account-1"
        )
        try expect(unattributed.total.total == 0, "unmapped session excluded from account filter")
        let allAccounts = UsageParser.aggregate(
            messages: [message],
            titles: [:],
            accountBySession: [:],
            period: .all,
            accountID: nil
        )
        try expect(allAccounts.total.total == 1500, "unmapped session retained in all accounts")

        try expect(
            WorkBuddyController.sessionDeepLink("session-abc")?.absoluteString
                == "workbuddy://chat/session-abc",
            "deep link"
        )

        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("openusage-selftest-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let databaseURL = directory.appendingPathComponent("test.db")
        FileManager.default.createFile(atPath: databaseURL.path, contents: Data())
        let database = try SQLiteDatabase(url: databaseURL, readOnly: false)
        try database.execute("CREATE TABLE rows (id TEXT PRIMARY KEY, value INTEGER)")
        let _ = try database.transaction {
            try database.execute(
                "INSERT INTO rows (id, value) VALUES (?, ?)",
                bindings: [.text("row-1"), .integer(42)]
            )
        }
        let rows = try database.query(
            "SELECT value FROM rows WHERE id = ?",
            bindings: [.text("row-1")]
        )
        try expect(rows.first?["value"]?.int64 == 42, "sqlite parameter binding")

        try database.execute(
            """
            CREATE TABLE sessions (
                id TEXT PRIMARY KEY,
                cwd TEXT NOT NULL,
                user_id TEXT NOT NULL,
                title TEXT,
                status TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )
            """
        )
        try database.execute(
            """
            INSERT INTO sessions (id, cwd, user_id, title, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            bindings: [
                .text("legacy-session"),
                .text("/tmp/project"),
                .text("legacy-account"),
                .text("Legacy title"),
                .text("done"),
                .integer(1_784_822_400_000)
            ]
        )
        let legacySessions = try SessionStore(databaseURL: databaseURL).loadSessions()
        try expect(legacySessions.count == 1, "legacy session schema")
        try expect(legacySessions.first?.title == "Legacy title", "legacy session title")
        try expect(legacySessions.first?.model == nil, "legacy optional model")

        let trashDatabaseURL = directory.appendingPathComponent("trash.db")
        _ = FileManager.default.createFile(atPath: trashDatabaseURL.path, contents: Data())
        let trashDatabase = try SQLiteDatabase(url: trashDatabaseURL, readOnly: false)
        try trashDatabase.execute(
            """
            CREATE TABLE sessions (
                id TEXT PRIMARY KEY,
                cwd TEXT NOT NULL,
                user_id TEXT NOT NULL,
                title TEXT,
                status TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER,
                deleted_at INTEGER
            )
            """
        )
        try trashDatabase.execute(
            """
            INSERT INTO sessions (
                id, cwd, user_id, title, status, created_at, updated_at, deleted_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            bindings: [
                .text("trash-session"),
                .text("/tmp/project"),
                .text("owner-account"),
                .text("Deleted title"),
                .text("done"),
                .integer(1_784_822_400_000),
                .integer(1_784_822_400_000),
                .integer(1_784_822_500_000)
            ]
        )
        let trashStore = SessionStore(databaseURL: trashDatabaseURL)
        var rejectedWrongOwner = false
        do {
            try trashStore.restoreFromTrash(
                "trash-session",
                expectedUserID: "other-account"
            )
        } catch OpenUsageError.sessionRestoreConflict {
            rejectedWrongOwner = true
        }
        try expect(rejectedWrongOwner, "trash restore rejects a mismatched owner")
        let sessionsAfterWrongOwner = try trashStore.loadSessions(includeDeleted: true)
        try expect(
            sessionsAfterWrongOwner.first?.isDeleted == true,
            "failed restore leaves trash state unchanged"
        )
        try trashStore.restoreFromTrash(
            "trash-session",
            expectedUserID: "owner-account"
        )
        let sessionsAfterRestore = try trashStore.loadSessions(includeDeleted: true)
        try expect(
            sessionsAfterRestore.first?.isDeleted == false,
            "matching owner restores trash session"
        )
        var rejectedNoChange = false
        do {
            try trashStore.restoreFromTrash(
                "trash-session",
                expectedUserID: "owner-account"
            )
        } catch OpenUsageError.sessionRestoreConflict {
            rejectedNoChange = true
        }
        try expect(rejectedNoChange, "zero-change trash restore reports a conflict")

        let cacheDatabaseURL = directory.appendingPathComponent("usage-cache.db")
        _ = FileManager.default.createFile(atPath: cacheDatabaseURL.path, contents: Data())
        let cacheDatabase = try SQLiteDatabase(url: cacheDatabaseURL, readOnly: false)
        try cacheDatabase.execute(
            """
            CREATE TABLE sessions (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                title TEXT
            )
            """
        )
        try cacheDatabase.execute(
            "INSERT INTO sessions (id, user_id, title) VALUES (?, ?, ?)",
            bindings: [
                .text("session-1"),
                .text("account-1"),
                .text("Cached session")
            ]
        )
        let projectsURL = directory.appendingPathComponent("projects", isDirectory: true)
        try FileManager.default.createDirectory(
            at: projectsURL,
            withIntermediateDirectories: true
        )
        let compactUsageLine = try JSONSerialization.data(
            withJSONObject: JSONSerialization.jsonObject(with: usageLine)
        )
        try compactUsageLine.write(to: projectsURL.appendingPathComponent("session.jsonl"))
        let usageService = UsageService(
            sessionStore: SessionStore(databaseURL: cacheDatabaseURL),
            projectsURL: projectsURL
        )
        let cachedForOriginalOwner = try await usageService.scan(
            period: .all,
            accountID: "account-1",
            force: true
        )
        try expect(
            cachedForOriginalOwner.total.total == 1500,
            "initial scan uses current session owner"
        )
        try cacheDatabase.execute(
            "UPDATE sessions SET user_id = ? WHERE id = ?",
            bindings: [.text("account-2"), .text("session-1")]
        )
        let cachedAfterOwnerChange = try await usageService.aggregateCached(
            period: .all,
            accountID: "account-1"
        )
        try expect(
            cachedAfterOwnerChange.total.total == 0,
            "cached transcript drops the previous session owner"
        )
        let cachedForNewOwner = try await usageService.aggregateCached(
            period: .all,
            accountID: "account-2"
        )
        try expect(
            cachedForNewOwner.total.total == 1500,
            "cached transcript uses the latest session owner"
        )

        print("OpenUsage self-test passed: \(assertions) assertions")
    }
}

private struct SelfTestFailure: LocalizedError {
    let message: String
    let file: String
    let line: UInt

    var errorDescription: String? {
        "\(file):\(line): \(message)"
    }
}
