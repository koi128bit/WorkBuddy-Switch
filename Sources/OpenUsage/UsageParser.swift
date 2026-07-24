import Foundation

enum UsageParser {
    struct FileParseResult: Sendable {
        var messages: [UsageMessage] = []
        var titles: [String: String] = [:]
    }

    static func parseLine(
        _ data: Data,
        sourceFingerprint _: String
    ) -> (message: UsageMessage?, title: (String, String)?) {
        guard
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let type = object["type"] as? String,
            let sessionID = string(object["sessionId"]),
            !sessionID.isEmpty
        else {
            return (nil, nil)
        }

        if type == "ai-title", let title = string(object["aiTitle"]), !title.isEmpty {
            return (nil, (sessionID, String(title.prefix(120))))
        }
        guard
            type == "message",
            string(object["role"]) == "assistant",
            let providerData = object["providerData"] as? [String: Any],
            let rawUsage = providerData["rawUsage"] as? [String: Any],
            let timestampMS = double(object["timestamp"]),
            timestampMS > 0
        else {
            return (nil, nil)
        }

        let prompt = max(int(rawUsage["prompt_tokens"]) ?? 0, 0)
        let completion = max(int(rawUsage["completion_tokens"]) ?? 0, 0)
        guard prompt + completion > 0 else { return (nil, nil) }
        let cacheRead = min(max(int(rawUsage["prompt_cache_hit_tokens"]) ?? 0, 0), prompt)
        let reasoning = min(max(int(rawUsage["completion_thinking_tokens"]) ?? 0, 0), completion)
        let credits = max(double(rawUsage["credit"]) ?? 0, 0)
        let timestamp = Date(timeIntervalSince1970: timestampMS / 1_000)
        let messageID = string(object["uuid"])
            ?? string(object["messageId"])
            ?? string(object["id"])
            ?? "\(Int64(timestampMS))-\(prompt)-\(completion)-\(stableHash(data))"

        return (
            UsageMessage(
                deduplicationKey: "\(sessionID):\(messageID)",
                sessionID: sessionID,
                timestamp: timestamp,
                model: string(providerData["model"]) ?? "auto",
                tokens: TokenBreakdown(
                    input: prompt - cacheRead,
                    output: completion,
                    cacheRead: cacheRead,
                    reasoning: reasoning
                ),
                credits: credits
            ),
            nil
        )
    }

    static func aggregate(
        messages: [UsageMessage],
        titles: [String: String],
        accountBySession: [String: String],
        period: UsagePeriod,
        accountID: String?
    ) -> UsageSnapshot {
        let calendar = Calendar.current
        let filtered = messages.filter { message in
            // Resolve ownership from the latest sessions table at aggregation time.
            // Unmapped sessions remain visible in "all accounts" and are excluded
            // from every account-specific result.
            let currentOwner = accountBySession[message.sessionID]
            let inAccount = accountID == nil || currentOwner == accountID
            let inPeriod = period.startDate.map { message.timestamp >= $0 } ?? true
            return inAccount && inPeriod
        }

        var total = TokenBreakdown()
        var credits = 0.0
        var daily: [Date: (tokens: Int, credits: Double)] = [:]
        var sessions: [String: (tokens: TokenBreakdown, credits: Double, last: Date)] = [:]
        var models: [String: (tokens: Int, credits: Double)] = [:]

        for message in filtered {
            total = total + message.tokens
            credits += message.credits
            let day = calendar.startOfDay(for: message.timestamp)
            var dayValue = daily[day] ?? (0, 0)
            dayValue.tokens += message.tokens.total
            dayValue.credits += message.credits
            daily[day] = dayValue

            var sessionValue = sessions[message.sessionID] ?? (TokenBreakdown(), 0, message.timestamp)
            sessionValue.tokens = sessionValue.tokens + message.tokens
            sessionValue.credits += message.credits
            sessionValue.last = max(sessionValue.last, message.timestamp)
            sessions[message.sessionID] = sessionValue

            var modelValue = models[message.model] ?? (0, 0)
            modelValue.tokens += message.tokens.total
            modelValue.credits += message.credits
            models[message.model] = modelValue
        }

        return UsageSnapshot(
            total: total,
            credits: credits,
            daily: daily.map {
                DailyUsagePoint(day: $0.key, tokens: $0.value.tokens, credits: $0.value.credits)
            }.sorted { $0.day < $1.day },
            sessions: sessions.map {
                SessionUsageSummary(
                    sessionID: $0.key,
                    title: titles[$0.key].flatMap { $0.isEmpty ? nil : $0 } ?? "未命名对话",
                    tokens: $0.value.tokens,
                    credits: $0.value.credits,
                    lastActivity: $0.value.last
                )
            }.sorted { $0.tokens.total > $1.tokens.total },
            models: models.map {
                ModelUsageSummary(model: $0.key, tokens: $0.value.tokens, credits: $0.value.credits)
            }.sorted { $0.tokens > $1.tokens },
            capturedAt: Date()
        )
    }

    private static func string(_ value: Any?) -> String? {
        if let value = value as? String { return value }
        if let value = value as? NSNumber { return value.stringValue }
        return nil
    }

    private static func int(_ value: Any?) -> Int? {
        if let value = value as? Int { return value }
        if let value = value as? NSNumber { return value.intValue }
        if let value = value as? String { return Int(value) }
        return nil
    }

    private static func double(_ value: Any?) -> Double? {
        if let value = value as? Double { return value }
        if let value = value as? Int { return Double(value) }
        if let value = value as? NSNumber { return value.doubleValue }
        if let value = value as? String { return Double(value) }
        return nil
    }

    private static func stableHash(_ data: Data) -> String {
        var hash: UInt64 = 14_695_981_039_346_656_037
        for byte in data {
            hash ^= UInt64(byte)
            hash &*= 1_099_511_628_211
        }
        return String(hash, radix: 16)
    }
}
