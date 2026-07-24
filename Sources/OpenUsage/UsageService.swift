import Foundation

actor UsageService {
    private struct CacheEntry {
        let modifiedAt: Date
        let size: Int
        let result: UsageParser.FileParseResult
    }

    private let sessionStore: SessionStore
    private let projectsURL: URL
    private var cache: [String: CacheEntry] = [:]
    private var lastMessages: [UsageMessage] = []
    private var lastTranscriptTitles: [String: String] = [:]
    private var lastScannedFiles = 0

    init(
        sessionStore: SessionStore = SessionStore(),
        projectsURL: URL = AppPaths.workBuddyProjects
    ) {
        self.sessionStore = sessionStore
        self.projectsURL = projectsURL
    }

    func scan(
        period: UsagePeriod,
        accountID: String?,
        force: Bool = false
    ) throws -> UsageSnapshot {
        var messages: [UsageMessage] = []
        var transcriptTitles: [String: String] = [:]
        var seenKeys = Set<String>()
        let files = jsonlFiles()
        let paths = Set(files.map(\.path))
        cache = cache.filter { paths.contains($0.key) }

        for url in files {
            let attributes = try? FileManager.default.attributesOfItem(atPath: url.path)
            let modifiedAt = attributes?[.modificationDate] as? Date ?? .distantPast
            let size = (attributes?[.size] as? NSNumber)?.intValue ?? 0
            let result: UsageParser.FileParseResult

            if !force, let cached = cache[url.path],
               cached.modifiedAt == modifiedAt, cached.size == size {
                result = cached.result
            } else {
                result = try parseFile(url)
                cache[url.path] = CacheEntry(
                    modifiedAt: modifiedAt,
                    size: size,
                    result: result
                )
            }
            for message in result.messages where seenKeys.insert(message.deduplicationKey).inserted {
                messages.append(message)
            }
            result.titles.forEach { transcriptTitles[$0.key] = $0.value }
        }

        let metadata = try sessionStore.usageMetadata()
        lastMessages = messages
        lastTranscriptTitles = transcriptTitles
        lastScannedFiles = files.count
        var titles = metadata.titlesBySession
        transcriptTitles.forEach { titles[$0.key] = $0.value }
        var snapshot = UsageParser.aggregate(
            messages: messages,
            titles: titles,
            accountBySession: metadata.accountBySession,
            period: period,
            accountID: accountID
        )
        snapshot.scannedFiles = files.count
        return snapshot
    }

    func aggregateCached(period: UsagePeriod, accountID: String?) throws -> UsageSnapshot {
        let metadata = try sessionStore.usageMetadata()
        var titles = metadata.titlesBySession
        lastTranscriptTitles.forEach { titles[$0.key] = $0.value }
        var snapshot = UsageParser.aggregate(
            messages: lastMessages,
            titles: titles,
            accountBySession: metadata.accountBySession,
            period: period,
            accountID: accountID
        )
        snapshot.scannedFiles = lastScannedFiles
        return snapshot
    }

    func fetchQuota() async throws -> QuotaSnapshot {
        let document = try AuthDocument.loadActive()
        let token = try document.accessToken()
        guard let url = URL(
            string: "https://www.codebuddy.cn/v2/billing/meter/get-user-resource"
        ) else {
            throw OpenUsageError.quotaUnavailable("额度服务地址无效。")
        }

        var request = URLRequest(url: url, timeoutInterval: 12)
        request.httpMethod = "POST"
        request.httpBody = Data("{}".utf8)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("WorkBuddy", forHTTPHeaderField: "User-Agent")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw OpenUsageError.quotaUnavailable("暂时无法获取 WorkBuddy 额度。")
        }
        guard
            let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let dataObject = root["data"] as? [String: Any],
            let responseObject = dataObject["Response"] as? [String: Any],
            let inner = responseObject["Data"] as? [String: Any],
            let accounts = inner["Accounts"] as? [[String: Any]]
        else {
            throw OpenUsageError.quotaUnavailable("WorkBuddy 返回了未知的额度格式。")
        }

        var total = 0.0
        var remaining = 0.0
        var packageName: String?
        var resetsAt: Date?
        for account in accounts {
            total += Self.number(account["CycleCapacitySize"])
            remaining += Self.number(account["CycleCapacityRemain"])
            packageName = packageName ?? account["PackageName"] as? String
            if resetsAt == nil, let value = account["CycleEndTime"] as? String {
                resetsAt = Self.parseCycleDate(value)
            }
        }
        guard total > 0 else {
            throw OpenUsageError.quotaUnavailable("当前账号没有可显示的额度数据。")
        }
        return QuotaSnapshot(
            sourceUserID: document.userID,
            used: max(total - remaining, 0),
            total: total,
            packageName: packageName,
            resetsAt: resetsAt,
            capturedAt: Date()
        )
    }

    private func jsonlFiles() -> [URL] {
        guard let enumerator = FileManager.default.enumerator(
            at: projectsURL,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: [.skipsHiddenFiles, .skipsPackageDescendants]
        ) else { return [] }
        return enumerator.compactMap { item in
            guard let url = item as? URL, url.pathExtension.lowercased() == "jsonl" else {
                return nil
            }
            return url
        }
    }

    private func parseFile(_ url: URL) throws -> UsageParser.FileParseResult {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }

        var result = UsageParser.FileParseResult()
        var buffer = Data()
        var lineNumber = 0
        while let chunk = try handle.read(upToCount: 64 * 1_024), !chunk.isEmpty {
            buffer.append(chunk)
            while let newline = buffer.firstRange(of: Data([0x0A])) {
                let line = buffer.subdata(in: 0..<newline.lowerBound)
                buffer.removeSubrange(0...newline.lowerBound)
                lineNumber += 1
                append(
                    line,
                    to: &result,
                    fingerprint: "\(url.lastPathComponent):\(lineNumber)"
                )
            }
        }
        if !buffer.isEmpty {
            append(
                buffer,
                to: &result,
                fingerprint: "\(url.lastPathComponent):tail"
            )
        }
        return result
    }

    private func append(
        _ line: Data,
        to result: inout UsageParser.FileParseResult,
        fingerprint: String
    ) {
        guard !line.isEmpty else { return }
        let parsed = UsageParser.parseLine(
            line,
            sourceFingerprint: fingerprint
        )
        if let message = parsed.message { result.messages.append(message) }
        if let title = parsed.title { result.titles[title.0] = title.1 }
    }

    private static func number(_ value: Any?) -> Double {
        if let value = value as? NSNumber { return value.doubleValue }
        if let value = value as? String { return Double(value) ?? 0 }
        return 0
    }

    private static func parseCycleDate(_ value: String) -> Date? {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return formatter.date(from: value)
    }
}
