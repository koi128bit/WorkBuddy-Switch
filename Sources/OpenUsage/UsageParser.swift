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
            let timestampMS = double(object["timestamp"]),
            timestampMS > 0
        else {
            return (nil, nil)
        }

        let rawUsage = providerData["rawUsage"] as? [String: Any]
        let normalizedUsage = providerData["usage"] as? [String: Any]
        guard rawUsage != nil || normalizedUsage != nil else { return (nil, nil) }

        let normalizedInputDetails = normalizedUsage?["inputTokensDetails"] as? [[String: Any]]
        let normalizedOutputDetails = normalizedUsage?["outputTokensDetails"] as? [[String: Any]]
        let reportedCacheRead = maximumNonnegativeInt([
            rawUsage?["prompt_cache_hit_tokens"],
            rawUsage?["cache_read_input_tokens"],
            rawUsage?["cached_tokens"],
            (rawUsage?["prompt_tokens_details"] as? [String: Any])?["cached_tokens"],
            sum(normalizedInputDetails, key: "cached_tokens")
        ])
        let reportedCacheWrite = maximumNonnegativeInt([
            rawUsage?["cache_creation_input_tokens"],
            rawUsage?["prompt_cache_write_tokens"],
            rawUsage?["cache_write_input_tokens"]
        ])
        let reportedCacheMiss = maximumNonnegativeInt([
            rawUsage?["prompt_cache_miss_tokens"]
        ])
        let reportedPrompt = maximumNonnegativeInt([
            rawUsage?["prompt_tokens"],
            normalizedUsage?["inputTokens"]
        ])
        // WorkBuddy reports prompt_cache_miss_tokens as the uncached portion of
        // prompt_tokens. It is not cache creation, but can reconstruct prompt
        // usage when an older record omits the aggregate prompt field.
        let reconstructedPrompt = reportedCacheRead
            + max(reportedCacheMiss, reportedCacheWrite)
        let prompt = max(reportedPrompt, reconstructedPrompt)
        let completion = maximumNonnegativeInt([
            rawUsage?["completion_tokens"],
            normalizedUsage?["outputTokens"]
        ])
        guard prompt + completion > 0 else { return (nil, nil) }

        let cacheRead = min(reportedCacheRead, prompt)
        let cacheWrite = min(reportedCacheWrite, prompt - cacheRead)
        let reasoning = min(
            maximumNonnegativeInt([
                rawUsage?["completion_thinking_tokens"],
                (rawUsage?["completion_tokens_details"] as? [String: Any])?["reasoning_tokens"],
                sum(normalizedOutputDetails, key: "reasoning_tokens")
            ]),
            completion
        )
        let requestCount = max(
            maximumNonnegativeInt([
                rawUsage?["requests"],
                normalizedUsage?["requests"]
            ]),
            1
        )
        let credits = max(double(rawUsage?["credit"]) ?? 0, 0)
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
                    input: prompt - cacheRead - cacheWrite,
                    output: completion,
                    cacheRead: cacheRead,
                    cacheWrite: cacheWrite,
                    reasoning: reasoning,
                    requestCount: requestCount
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
        let today = Calendar.current.startOfDay(for: Date())
        return aggregate(
            messages: messages,
            titles: titles,
            accountBySession: accountBySession,
            range: period.dateRange(customStart: today, customEnd: today),
            accountID: accountID
        )
    }

    static func aggregate(
        messages: [UsageMessage],
        titles: [String: String],
        accountBySession: [String: String],
        range: UsageDateRange,
        accountID: String?
    ) -> UsageSnapshot {
        let calendar = Calendar.current
        let filtered = messages.filter { message in
            // Resolve ownership from the latest sessions table at aggregation time.
            // Unmapped sessions remain visible in "all accounts" and are excluded
            // from every account-specific result.
            let currentOwner = accountBySession[message.sessionID]
            let inAccount = accountID == nil || currentOwner == accountID
            return inAccount && range.contains(message.timestamp)
        }

        var total = TokenBreakdown()
        var credits = 0.0
        var daily: [Date: (tokens: TokenBreakdown, credits: Double)] = [:]
        var hourly: [Date: (tokens: TokenBreakdown, credits: Double)] = [:]
        var modelDaily: [Date: [String: (tokens: TokenBreakdown, credits: Double)]] = [:]
        var modelHourly: [Date: [String: (tokens: TokenBreakdown, credits: Double)]] = [:]
        var sessions: [String: (tokens: TokenBreakdown, credits: Double, last: Date)] = [:]
        var models: [String: (tokens: TokenBreakdown, credits: Double)] = [:]

        for message in filtered {
            total = total + message.tokens
            credits += message.credits
            let day = calendar.startOfDay(for: message.timestamp)
            var dayValue = daily[day] ?? (TokenBreakdown(), 0)
            dayValue.tokens = dayValue.tokens + message.tokens
            dayValue.credits += message.credits
            daily[day] = dayValue

            let hour = calendar.dateInterval(of: .hour, for: message.timestamp)?.start
                ?? message.timestamp
            var hourValue = hourly[hour] ?? (TokenBreakdown(), 0)
            hourValue.tokens = hourValue.tokens + message.tokens
            hourValue.credits += message.credits
            hourly[hour] = hourValue

            var modelsForDay = modelDaily[day] ?? [:]
            var modelDayValue = modelsForDay[message.model] ?? (TokenBreakdown(), 0)
            modelDayValue.tokens = modelDayValue.tokens + message.tokens
            modelDayValue.credits += message.credits
            modelsForDay[message.model] = modelDayValue
            modelDaily[day] = modelsForDay

            var modelsForHour = modelHourly[hour] ?? [:]
            var modelHourValue = modelsForHour[message.model] ?? (TokenBreakdown(), 0)
            modelHourValue.tokens = modelHourValue.tokens + message.tokens
            modelHourValue.credits += message.credits
            modelsForHour[message.model] = modelHourValue
            modelHourly[hour] = modelsForHour

            var sessionValue = sessions[message.sessionID] ?? (TokenBreakdown(), 0, message.timestamp)
            sessionValue.tokens = sessionValue.tokens + message.tokens
            sessionValue.credits += message.credits
            sessionValue.last = max(sessionValue.last, message.timestamp)
            sessions[message.sessionID] = sessionValue

            var modelValue = models[message.model] ?? (TokenBreakdown(), 0)
            modelValue.tokens = modelValue.tokens + message.tokens
            modelValue.credits += message.credits
            models[message.model] = modelValue
        }

        var dailyPoints: [DailyUsagePoint] = []
        for (day, value) in daily {
            dailyPoints.append(
                DailyUsagePoint(
                    day: day,
                    breakdown: value.tokens,
                    credits: value.credits
                )
            )
        }
        dailyPoints.sort { $0.day < $1.day }

        var hourlyPoints: [HourlyUsagePoint] = []
        for (hour, value) in hourly {
            hourlyPoints.append(
                HourlyUsagePoint(
                    hour: hour,
                    breakdown: value.tokens,
                    credits: value.credits
                )
            )
        }
        hourlyPoints.sort { $0.hour < $1.hour }

        var modelDailyPoints: [ModelDailyUsagePoint] = []
        for (day, values) in modelDaily {
            for (model, value) in values {
                modelDailyPoints.append(
                    ModelDailyUsagePoint(
                        day: day,
                        model: model,
                        tokens: value.tokens,
                        credits: value.credits
                    )
                )
            }
        }
        modelDailyPoints.sort {
            $0.day == $1.day ? $0.model < $1.model : $0.day < $1.day
        }

        var modelHourlyPoints: [ModelHourlyUsagePoint] = []
        for (hour, values) in modelHourly {
            for (model, value) in values {
                modelHourlyPoints.append(
                    ModelHourlyUsagePoint(
                        hour: hour,
                        model: model,
                        tokens: value.tokens,
                        credits: value.credits
                    )
                )
            }
        }
        modelHourlyPoints.sort {
            $0.hour == $1.hour ? $0.model < $1.model : $0.hour < $1.hour
        }

        var sessionSummaries: [SessionUsageSummary] = []
        for (sessionID, value) in sessions {
            let title = titles[sessionID].flatMap { $0.isEmpty ? nil : $0 }
                ?? "未命名对话"
            sessionSummaries.append(
                SessionUsageSummary(
                    sessionID: sessionID,
                    title: title,
                    tokens: value.tokens,
                    credits: value.credits,
                    lastActivity: value.last
                )
            )
        }
        sessionSummaries.sort { $0.tokens.total > $1.tokens.total }

        var modelSummaries: [ModelUsageSummary] = []
        for (model, value) in models {
            modelSummaries.append(
                ModelUsageSummary(
                    model: model,
                    tokens: value.tokens,
                    credits: value.credits
                )
            )
        }
        modelSummaries.sort { $0.tokens.total > $1.tokens.total }

        return UsageSnapshot(
            total: total,
            credits: credits,
            daily: dailyPoints,
            hourly: hourlyPoints,
            modelDaily: modelDailyPoints,
            modelHourly: modelHourlyPoints,
            sessions: sessionSummaries,
            models: modelSummaries,
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

    private static func maximumNonnegativeInt(_ values: [Any?]) -> Int {
        values.compactMap(int).map { max($0, 0) }.max() ?? 0
    }

    private static func sum(_ values: [[String: Any]]?, key: String) -> Int? {
        guard let values else { return nil }
        let numbers = values.compactMap { int($0[key]) }.map { max($0, 0) }
        guard !numbers.isEmpty else { return nil }
        return numbers.reduce(0, +)
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
