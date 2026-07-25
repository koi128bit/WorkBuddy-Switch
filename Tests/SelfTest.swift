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
        try expect(message.tokens.cacheWrite == 0, "cache write defaults to zero")
        try expect(message.tokens.reasoning == 80, "reasoning")
        try expect(message.tokens.requestCount == 1, "usage record defaults to one request")
        try expect(message.tokens.total == 1500, "total")
        try expect(message.credits == 1.25, "credits")
        try expect(
            parsedA.message?.deduplicationKey == parsedB.message?.deduplicationKey,
            "copied rows must deduplicate"
        )

        let cacheWriteLine = Data(
            """
            {
              "type": "message",
              "role": "assistant",
              "sessionId": "cache-write-session",
              "id": "cache-write-message",
              "timestamp": 1784822400000,
              "providerData": {
                "model": "fixture-model",
                "rawUsage": {
                  "prompt_tokens": 1000,
                  "completion_tokens": 100,
                  "prompt_cache_hit_tokens": 400,
                  "prompt_cache_miss_tokens": 600,
                  "cache_creation_input_tokens": 250,
                  "prompt_cache_write_tokens": 250,
                  "completion_tokens_details": {
                    "reasoning_tokens": 30
                  }
                }
              }
            }
            """.utf8
        )
        guard let cacheWriteMessage = UsageParser.parseLine(
            cacheWriteLine,
            sourceFingerprint: "cache-write"
        ).message else {
            throw SelfTestFailure(
                message: "cache-write usage missing",
                file: #filePath,
                line: #line
            )
        }
        try expect(cacheWriteMessage.tokens.input == 350, "cache write removed from net input")
        try expect(cacheWriteMessage.tokens.cacheRead == 400, "explicit cache read")
        try expect(cacheWriteMessage.tokens.cacheWrite == 250, "duplicate cache write fields use max")
        try expect(cacheWriteMessage.tokens.reasoning == 30, "reasoning detail fallback")
        try expect(cacheWriteMessage.tokens.total == 1100, "cache split preserves reported total")
        try expect(cacheWriteMessage.credits == 0, "tokens without credit are not converted")

        let normalizedOnlyLine = Data(
            """
            {
              "type": "message",
              "role": "assistant",
              "sessionId": "normalized-session",
              "id": "normalized-message",
              "timestamp": 1784822400000,
              "providerData": {
                "model": "normalized-model",
                "usage": {
                  "requests": 2,
                  "inputTokens": 2200,
                  "outputTokens": 300,
                  "inputTokensDetails": [{ "cached_tokens": 2000 }],
                  "outputTokensDetails": [{ "reasoning_tokens": 75 }]
                }
              }
            }
            """.utf8
        )
        guard let normalizedMessage = UsageParser.parseLine(
            normalizedOnlyLine,
            sourceFingerprint: "normalized"
        ).message else {
            throw SelfTestFailure(
                message: "normalized usage missing",
                file: #filePath,
                line: #line
            )
        }
        try expect(normalizedMessage.tokens.input == 200, "normalized net input")
        try expect(normalizedMessage.tokens.output == 300, "normalized output")
        try expect(normalizedMessage.tokens.cacheRead == 2000, "normalized cache details")
        try expect(normalizedMessage.tokens.reasoning == 75, "normalized reasoning details")
        try expect(normalizedMessage.tokens.requestCount == 2, "normalized request count")
        try expect(normalizedMessage.tokens.total == 2500, "normalized total")

        let missingUsageLine = Data(
            """
            {
              "type": "message",
              "role": "assistant",
              "sessionId": "missing-usage-session",
              "id": "missing-usage-message",
              "timestamp": 1784822400000,
              "providerData": { "model": "kimi-k3-1" }
            }
            """.utf8
        )
        try expect(
            UsageParser.parseLine(
                missingUsageLine,
                sourceFingerprint: "missing-usage"
            ).message == nil,
            "messages without official usage are not estimated"
        )

        let kimiParts: [(prompt: Int, cacheHit: Int, output: Int, credit: Double)] = [
            (300_000, 299_500, 400, 15.39),
            (300_000, 299_500, 400, 16.50),
            (300_000, 299_500, 400, 17.69),
            (300_000, 299_500, 400, 15.24),
            (293_390, 292_944, 531, 10.04)
        ]
        var kimiMessages: [UsageMessage] = []
        for (index, part) in kimiParts.enumerated() {
            let object: [String: Any] = [
                "type": "message",
                "role": "assistant",
                "sessionId": "kimi-session",
                "id": "kimi-message-\(index)",
                "timestamp": 1_784_822_400_000 + index,
                "providerData": [
                    "model": "kimi-k3-1",
                    "usage": [
                        "requests": 1,
                        "inputTokens": part.prompt,
                        "outputTokens": part.output
                    ],
                    "rawUsage": [
                        "prompt_tokens": part.prompt,
                        "completion_tokens": part.output,
                        "prompt_cache_hit_tokens": part.cacheHit,
                        "prompt_cache_miss_tokens": part.prompt - part.cacheHit,
                        "cache_creation_input_tokens": 0,
                        "prompt_cache_write_tokens": 0,
                        "completion_thinking_tokens": 1,
                        "credit": part.credit
                    ]
                ]
            ]
            let data = try JSONSerialization.data(withJSONObject: object)
            guard let parsed = UsageParser.parseLine(
                data,
                sourceFingerprint: "kimi-\(index)"
            ).message else {
                throw SelfTestFailure(
                    message: "Kimi usage record \(index) missing",
                    file: #filePath,
                    line: #line
                )
            }
            kimiMessages.append(parsed)
        }
        let kimiSnapshot = UsageParser.aggregate(
            messages: kimiMessages,
            titles: ["kimi-session": "Kimi fixture"],
            accountBySession: ["kimi-session": "account-1"],
            period: .all,
            accountID: "account-1"
        )
        guard let kimiModel = kimiSnapshot.models.first(where: { $0.model == "kimi-k3-1" }) else {
            throw SelfTestFailure(
                message: "Kimi model summary missing",
                file: #filePath,
                line: #line
            )
        }
        try expect(kimiModel.tokens.input == 2_446, "Kimi net input")
        try expect(kimiModel.tokens.output == 2_131, "Kimi output exceeds 2,000")
        try expect(kimiModel.tokens.cacheRead == 1_490_944, "Kimi cache hit")
        try expect(kimiModel.tokens.cacheWrite == 0, "Kimi cache write remains zero")
        try expect(kimiModel.tokens.reasoning == 5, "Kimi reasoning")
        try expect(kimiModel.tokens.requestCount == 5, "Kimi request count")
        try expect(kimiModel.tokens.total == 1_495_521, "Kimi total")
        try expect(
            abs(kimiModel.credits - 74.86) < 0.000_001,
            "Kimi model exposes only locally recorded Credits"
        )
        try expect(
            abs(kimiSnapshot.credits - 74.86) < 0.000_001,
            "usage snapshot keeps locally attributable Credits separate"
        )
        try expect(
            kimiSnapshot.daily.first?.breakdown == kimiModel.tokens,
            "daily breakdown preserves Kimi token components"
        )
        try expect(
            kimiSnapshot.modelDaily.first?.tokens == kimiModel.tokens,
            "model/day series preserves Kimi token components"
        )
        try expect(
            kimiSnapshot.hourly.first?.breakdown == kimiModel.tokens,
            "hourly breakdown preserves Kimi token components"
        )
        try expect(
            kimiSnapshot.modelHourly.first?.tokens == kimiModel.tokens,
            "model/hour series preserves Kimi token components"
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

        var utcCalendar = Calendar(identifier: .gregorian)
        utcCalendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let rangeStart = utcCalendar.date(
            from: DateComponents(year: 2026, month: 7, day: 24)
        )!
        let secondDay = utcCalendar.date(byAdding: .day, value: 1, to: rangeStart)!
        let rangeEnd = utcCalendar.date(byAdding: .day, value: 2, to: rangeStart)!
        let boundaryTimestamps = [
            rangeStart.addingTimeInterval(-0.001),
            rangeStart,
            rangeEnd.addingTimeInterval(-0.001),
            rangeEnd
        ]
        let boundaryMessages = boundaryTimestamps.enumerated().map { index, timestamp in
            UsageMessage(
                deduplicationKey: "boundary-\(index)",
                sessionID: "boundary-session",
                timestamp: timestamp,
                model: "boundary-model",
                tokens: TokenBreakdown(input: 1, requestCount: 1),
                credits: 0
            )
        }
        let inclusiveDayRange = UsageDateRange(
            startInclusive: rangeStart,
            endExclusive: rangeEnd
        )
        let boundarySnapshot = UsageParser.aggregate(
            messages: boundaryMessages,
            titles: ["boundary-session": "Boundary"],
            accountBySession: ["boundary-session": "account-1"],
            range: inclusiveDayRange,
            accountID: "account-1"
        )
        try expect(boundarySnapshot.total.total == 2, "date range includes both day boundaries")
        try expect(
            boundarySnapshot.total.requestCount == 2,
            "date range excludes the exact end-exclusive instant"
        )
        try expect(boundarySnapshot.hourly.count == 2, "range aggregation produces hourly points")
        try expect(
            boundarySnapshot.modelHourly.count == 2,
            "range aggregation produces model/hour points"
        )

        let singleDayRange = UsagePeriod.today.dateRange(
            customStart: rangeStart,
            customEnd: rangeStart,
            now: rangeStart.addingTimeInterval(12 * 60 * 60),
            calendar: utcCalendar
        )
        try expect(
            singleDayRange.startInclusive == rangeStart,
            "today starts at local midnight"
        )
        try expect(
            singleDayRange.endExclusive == secondDay,
            "today ends at the next local midnight"
        )
        try expect(
            singleDayRange.spansSingleDay(calendar: utcCalendar),
            "today selects hourly trend granularity"
        )

        let customRange = UsagePeriod.custom.dateRange(
            customStart: secondDay,
            customEnd: rangeStart,
            now: rangeStart,
            calendar: utcCalendar
        )
        try expect(
            customRange.startInclusive == rangeStart,
            "custom range normalizes a reversed start"
        )
        try expect(
            customRange.endExclusive == rangeEnd,
            "custom range includes the selected end date"
        )
        try expect(
            !customRange.spansSingleDay(calendar: utcCalendar),
            "multi-day custom range selects daily trend granularity"
        )

        let preciseQuotaAccount: [String: Any] = [
            "CycleCapacityRemainPrecise": "599.0400001",
            "CycleCapacityRemain": 599
        ]
        try expect(
            abs(
                UsageService.quotaAmount(
                    in: preciseQuotaAccount,
                    preciseKey: "CycleCapacityRemainPrecise",
                    fallbackKey: "CycleCapacityRemain"
                ) - 599.0400001
            ) < 0.000_000_01,
            "quota parsing prefers the precise value"
        )
        let fallbackQuotaAccount: [String: Any] = ["CycleCapacitySize": 2800]
        try expect(
            UsageService.quotaAmount(
                in: fallbackQuotaAccount,
                preciseKey: "CycleCapacitySizePrecise",
                fallbackKey: "CycleCapacitySize"
            ) == 2800,
            "quota parsing falls back to the legacy value"
        )

        try expect(
            WorkBuddyController.sessionDeepLink("session-abc")?.absoluteString
                == "workbuddy://chat/session-abc",
            "deep link"
        )
        try expect(
            !WorkBuddyController.isInteractiveCLICommand(
                "/Applications/WorkBuddy.app/Contents/MacOS/Electron codebuddy --serve --port 1234"
            ),
            "background WorkBuddy service is not treated as an interactive CLI"
        )
        try expect(
            WorkBuddyController.isInteractiveCLICommand(
                "/usr/bin/node codebuddy --resume session-abc"
            ),
            "terminal WorkBuddy resume is detected before migration"
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

        let migrationDatabaseURL = directory.appendingPathComponent("migration.db")
        let migrationBackupsURL = directory
            .appendingPathComponent("migration-backups", isDirectory: true)
        do {
            _ = FileManager.default.createFile(
                atPath: migrationDatabaseURL.path,
                contents: Data()
            )
            let migrationDatabase = try SQLiteDatabase(
                url: migrationDatabaseURL,
                readOnly: false
            )
            let journalMode = try migrationDatabase.query("PRAGMA journal_mode = WAL")
            try expect(
                journalMode.first?["journal_mode"]?.string?.lowercased() == "wal",
                "migration fixture uses WAL journal mode"
            )
            try migrationDatabase.execute(
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
            for (id, owner, deletedAt) in [
                ("move-selected", "source-account", nil),
                ("leave-source", "source-account", nil),
                ("deleted-selected", "source-account", 1_784_822_500_000),
                ("already-current", "target-account", nil)
            ] as [(String, String, Int64?)] {
                try migrationDatabase.execute(
                    """
                    INSERT INTO sessions (
                        id, cwd, user_id, title, status, created_at, updated_at, deleted_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    bindings: [
                        .text(id),
                        .text("/tmp/project"),
                        .text(owner),
                        .text(id),
                        .text("done"),
                        .integer(1_784_822_400_000),
                        .integer(1_784_822_400_000),
                        deletedAt.map(SQLiteValue.integer) ?? .null
                    ]
                )
            }
        }
        let migrationStore = SessionStore(
            databaseURL: migrationDatabaseURL,
            backupDirectoryURL: migrationBackupsURL
        )
        let unchangedMutation = try migrationStore.prepareSessionForResume(
            sessionID: "already-current",
            expectedSourceUserID: "target-account",
            targetUserID: "target-account",
            restoreFromTrash: false
        )
        try expect(!unchangedMutation.changedLocalState, "same-account resume is a no-op")
        try expect(unchangedMutation.backupURL == nil, "same-account resume skips backup")
        try expect(
            !FileManager.default.fileExists(atPath: migrationBackupsURL.path),
            "same-account resume does not create a backup directory"
        )

        var rejectedMigrationOwner = false
        do {
            _ = try migrationStore.prepareSessionForResume(
                sessionID: "move-selected",
                expectedSourceUserID: "wrong-account",
                targetUserID: "target-account",
                restoreFromTrash: false
            )
        } catch OpenUsageError.sessionRestoreConflict {
            rejectedMigrationOwner = true
        }
        try expect(rejectedMigrationOwner, "migration rejects a mismatched source owner")
        let beforeMigration = try migrationStore.loadSessions(includeDeleted: true)
        try expect(
            beforeMigration.first { $0.id == "move-selected" }?.userID == "source-account",
            "rejected migration leaves the selected session unchanged"
        )

        // WorkBuddy can remove WAL sidecars while leaving the main database in WAL mode.
        var stoppedWorkBuddyDatabase: SQLiteDatabase? = try SQLiteDatabase(
            url: migrationDatabaseURL,
            readOnly: false
        )
        try stoppedWorkBuddyDatabase?.checkpointWAL()
        stoppedWorkBuddyDatabase = nil
        for suffix in ["-wal", "-shm"] {
            let sidecarURL = URL(fileURLWithPath: migrationDatabaseURL.path + suffix)
            if FileManager.default.fileExists(atPath: sidecarURL.path) {
                try FileManager.default.removeItem(at: sidecarURL)
            }
        }
        try expect(
            !FileManager.default.fileExists(atPath: migrationDatabaseURL.path + "-wal")
                && !FileManager.default.fileExists(atPath: migrationDatabaseURL.path + "-shm"),
            "stopped WorkBuddy fixture has no WAL sidecars"
        )

        let migrated = try migrationStore.prepareSessionForResume(
            sessionID: "move-selected",
            expectedSourceUserID: "source-account",
            targetUserID: "target-account",
            restoreFromTrash: false
        )
        try expect(migrated.reassignedToCurrentAccount, "selected session is reassigned")
        try expect(!migrated.restoredFromTrash, "active session is not marked restored")
        guard let firstBackupURL = migrated.backupURL else {
            throw SelfTestFailure(
                message: "migration backup missing",
                file: #filePath,
                line: #line
            )
        }
        try expect(
            FileManager.default.fileExists(atPath: firstBackupURL.path),
            "migration creates a recoverable backup"
        )
        let backupDatabase = try SQLiteDatabase(url: firstBackupURL, readOnly: true)
        let backupCheck = try backupDatabase.query("PRAGMA quick_check")
        try expect(
            backupCheck.first?["quick_check"]?.string == "ok",
            "migration backup passes SQLite quick_check"
        )
        let backupJournalMode = try backupDatabase.query("PRAGMA journal_mode")
        try expect(
            backupJournalMode.first?["journal_mode"]?.string?.lowercased() == "delete",
            "migration backup is self-contained outside WAL mode"
        )
        try expect(
            !FileManager.default.fileExists(atPath: firstBackupURL.path + "-wal")
                && !FileManager.default.fileExists(atPath: firstBackupURL.path + "-shm"),
            "migration backup does not depend on SQLite sidecars"
        )
        let backupOwner = try backupDatabase.query(
            "SELECT user_id FROM sessions WHERE id = ?",
            bindings: [.text("move-selected")]
        )
        try expect(
            backupOwner.first?["user_id"]?.string == "source-account",
            "backup captures the owner before mutation"
        )

        let afterMigration = try migrationStore.loadSessions(includeDeleted: true)
        try expect(
            afterMigration.first { $0.id == "move-selected" }?.userID == "target-account",
            "selected session moves to the target account"
        )
        try expect(
            afterMigration.first { $0.id == "leave-source" }?.userID == "source-account",
            "other sessions from the source account do not move"
        )

        let restoredAndMigrated = try migrationStore.prepareSessionForResume(
            sessionID: "deleted-selected",
            expectedSourceUserID: "source-account",
            targetUserID: "target-account",
            restoreFromTrash: true
        )
        try expect(
            restoredAndMigrated.reassignedToCurrentAccount
                && restoredAndMigrated.restoredFromTrash,
            "deleted session restores and reassigns atomically"
        )
        let afterDeletedMigration = try migrationStore.loadSessions(includeDeleted: true)
        let restoredSession = afterDeletedMigration.first { $0.id == "deleted-selected" }
        try expect(restoredSession?.userID == "target-account", "restored session owner")
        try expect(restoredSession?.isDeleted == false, "restored session leaves trash")
        try expect(
            restoredSession?.updatedAt ?? .distantPast > Date(timeIntervalSince1970: 1_784_822_400),
            "trash restoration advances the update timestamp"
        )

        let blockedBackupURL = directory.appendingPathComponent("backup-path-is-a-file")
        try Data("blocked".utf8).write(to: blockedBackupURL)
        let blockedBackupStore = SessionStore(
            databaseURL: migrationDatabaseURL,
            backupDirectoryURL: blockedBackupURL
        )
        var rejectedMissingBackup = false
        do {
            _ = try blockedBackupStore.prepareSessionForResume(
                sessionID: "leave-source",
                expectedSourceUserID: "source-account",
                targetUserID: "target-account",
                restoreFromTrash: false
            )
        } catch {
            rejectedMissingBackup = true
        }
        try expect(rejectedMissingBackup, "migration stops when backup creation fails")
        let afterBackupFailure = try migrationStore.loadSessions(includeDeleted: true)
        try expect(
            afterBackupFailure.first { $0.id == "leave-source" }?.userID == "source-account",
            "backup failure leaves session ownership unchanged"
        )

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
        let cacheStore = SessionStore(
            databaseURL: cacheDatabaseURL,
            backupDirectoryURL: directory.appendingPathComponent(
                "usage-cache-backups",
                isDirectory: true
            )
        )
        let usageService = UsageService(
            sessionStore: cacheStore,
            projectsURL: projectsURL
        )
        var rejectedUninitializedUsageCache = false
        do {
            _ = try await usageService.aggregateCached(
                period: .all,
                accountID: "account-1"
            )
        } catch OpenUsageError.usageCacheUnavailable {
            rejectedUninitializedUsageCache = true
        }
        try expect(
            rejectedUninitializedUsageCache,
            "uninitialized usage cache cannot publish a false empty snapshot"
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
        let inclusiveCachedRange = UsageDateRange(
            startInclusive: message.timestamp,
            endExclusive: message.timestamp.addingTimeInterval(1)
        )
        let cachedInsideRange = try await usageService.aggregateCached(
            range: inclusiveCachedRange,
            accountID: "account-1"
        )
        try expect(
            cachedInsideRange.total.total == 1500,
            "cached aggregation includes the exact range start"
        )
        let cachedOutsideRange = try await usageService.aggregateCached(
            range: UsageDateRange(
                startInclusive: message.timestamp.addingTimeInterval(1),
                endExclusive: nil
            ),
            accountID: "account-1"
        )
        try expect(
            cachedOutsideRange.total.total == 0,
            "cached aggregation applies a custom range"
        )

        let cancelledScan = Task {
            withUnsafeCurrentTask { task in
                task?.cancel()
            }
            return try await usageService.scan(
                period: .all,
                accountID: "account-1"
            )
        }
        var scanObservedCancellation = false
        do {
            _ = try await cancelledScan.value
        } catch is CancellationError {
            scanObservedCancellation = true
        }
        try expect(scanObservedCancellation, "usage scan observes task cancellation")

        let usageMigration = try cacheStore.prepareSessionForResume(
            sessionID: "session-1",
            expectedSourceUserID: "account-1",
            targetUserID: "account-2",
            restoreFromTrash: false
        )
        try expect(
            usageMigration.reassignedToCurrentAccount,
            "usage fixture migrates through the production session API"
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
