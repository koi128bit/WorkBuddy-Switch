import Foundation

enum TraeQuotaUnit: String, Hashable, Sendable {
    case credits
    case requests
}

struct TraeQuotaSummary: Hashable, Sendable {
    let sourceUserID: String
    let used: Double
    let total: Double?
    let payGoUsed: Double
    let unit: TraeQuotaUnit
    let packageName: String
    let cycleStartsAt: Date?
    let resetsAt: Date?
    let capturedAt: Date

    var isUnlimited: Bool { total == nil }
    var remaining: Double? { total.map { max($0 - used, 0) } }

    /// Compatibility for existing WorkBuddy-oriented views. New UI should use
    /// `isUnlimited` to render an infinity label instead of this finite shim.
    var quotaSnapshot: QuotaSnapshot {
        QuotaSnapshot(
            sourceUserID: sourceUserID,
            used: used,
            total: total ?? max(used, 0),
            packageName: packageName,
            cycleStartsAt: cycleStartsAt,
            resetsAt: resetsAt,
            capturedAt: capturedAt
        )
    }
}

struct TraeUsageReport: Hashable, Sendable {
    let usage: UsageSnapshot
    let quota: TraeQuotaSummary
}

struct TraeUsageSessionRecord: Hashable, Sendable {
    let sessionID: String
    let timestamp: Date
    let model: String
    let mode: String
    let tokens: TokenBreakdown
    let credits: Double
    let cost: Double
}

struct TraeUsagePage: Hashable, Sendable {
    let total: Int
    let hasExplicitTotal: Bool
    let rowCount: Int
    let invalidRowCount: Int
    let records: [TraeUsageSessionRecord]
}

enum TraeOfficialHostPolicy {
    private static let allowedHosts: Set<String> = [
        "api.trae.cn",
        "api.trae.com.cn",
        "api-sg-central.trae.ai",
        "api-us-east.trae.ai",
        "grow-normal.trae.ai",
        "growsg-normal.trae.ai",
        "grow-normal.traeapi.us"
    ]

    static func baseURL(
        rawHost: String?,
        variant: TraeVariant
    ) throws -> URL {
        let candidate: URL
        if let rawHost {
            let trimmed = rawHost.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty {
                candidate = variant.defaultAPIBaseURL
            } else if trimmed.contains("://") {
                guard let url = URL(string: trimmed) else {
                    throw TraeSupportError.unsafeAPIHost
                }
                candidate = url
            } else {
                guard let url = URL(string: "https://\(trimmed)") else {
                    throw TraeSupportError.unsafeAPIHost
                }
                candidate = url
            }
        } else {
            candidate = variant.defaultAPIBaseURL
        }

        guard
            isAllowedConnectionURL(candidate),
            candidate.query == nil,
            candidate.fragment == nil,
            candidate.path.isEmpty || candidate.path == "/",
            let host = candidate.host?.lowercased()
        else {
            throw TraeSupportError.unsafeAPIHost
        }
        var components = URLComponents()
        components.scheme = "https"
        components.host = host
        if candidate.port == 443 {
            components.port = 443
        }
        guard let result = components.url else {
            throw TraeSupportError.unsafeAPIHost
        }
        return result
    }

    static func validateConnectionURL(_ url: URL) throws {
        guard isAllowedConnectionURL(url) else {
            throw TraeSupportError.unsafeAPIHost
        }
    }

    static func isAllowedConnectionURL(_ url: URL) -> Bool {
        guard
            url.scheme?.lowercased() == "https",
            url.user == nil,
            url.password == nil,
            url.port == nil || url.port == 443,
            let host = url.host?.lowercased(),
            allowedHosts.contains(host)
        else {
            return false
        }
        return true
    }
}

protocol TraeHTTPClient: Sendable {
    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

struct URLSessionTraeHTTPClient: TraeHTTPClient {
    let session: URLSession

    init(session: URLSession? = nil) {
        if let session {
            self.session = session
        } else {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.httpShouldSetCookies = false
            configuration.httpCookieAcceptPolicy = .never
            self.session = URLSession(
                configuration: configuration,
                delegate: TraeRedirectPolicyDelegate(),
                delegateQueue: nil
            )
        }
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await session.data(for: request)
        guard
            let httpResponse = response as? HTTPURLResponse,
            let responseURL = httpResponse.url
        else {
            throw TraeSupportError.requestFailed("Trae 用量服务返回了无效响应。")
        }
        try TraeOfficialHostPolicy.validateConnectionURL(responseURL)
        return (data, httpResponse)
    }
}

final class TraeRedirectPolicyDelegate: NSObject, URLSessionTaskDelegate,
    @unchecked Sendable
{
    static func allowedRedirectRequest(_ request: URLRequest) -> URLRequest? {
        guard
            let url = request.url,
            TraeOfficialHostPolicy.isAllowedConnectionURL(url)
        else {
            return nil
        }
        return request
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(Self.allowedRedirectRequest(request))
    }
}

actor TraeUsageService {
    private let client: any TraeHTTPClient
    private let storageURL: @Sendable (TraeVariant) -> URL
    private let usagePageSize: Int
    private let paginationPageLimit: Int

    init(
        client: any TraeHTTPClient = URLSessionTraeHTTPClient(),
        storageURL: @escaping @Sendable (TraeVariant) -> URL = {
            TraeDataLocation.resolve($0).storageURL
        },
        usagePageSize: Int = 100,
        paginationPageLimit: Int = 100
    ) {
        self.client = client
        self.storageURL = storageURL
        self.usagePageSize = max(1, usagePageSize)
        self.paginationPageLimit = max(1, paginationPageLimit)
    }

    func fetchReport(
        for variant: TraeVariant,
        range: UsageDateRange
    ) async throws -> TraeUsageReport {
        let credentials = try currentCredentials(for: variant)
        async let usage = fetchUsage(
            payload: credentials.payload,
            variant: variant,
            range: range
        )
        async let quota = fetchQuota(
            payload: credentials.payload,
            variant: variant
        )
        return try await TraeUsageReport(usage: usage, quota: quota)
    }

    func fetchUsage(
        for variant: TraeVariant,
        range: UsageDateRange
    ) async throws -> UsageSnapshot {
        let credentials = try currentCredentials(for: variant)
        return try await fetchUsage(
            payload: credentials.payload,
            variant: variant,
            range: range
        )
    }

    func fetchUsage(
        snapshot: TraeCredentialSnapshot,
        range: UsageDateRange
    ) async throws -> UsageSnapshot {
        let payload = try verifiedPayload(snapshot)
        return try await fetchUsage(
            payload: payload,
            variant: snapshot.variant,
            range: range
        )
    }

    func fetchQuota(for variant: TraeVariant) async throws -> TraeQuotaSummary {
        let credentials = try currentCredentials(for: variant)
        return try await fetchQuota(
            payload: credentials.payload,
            variant: variant
        )
    }

    func fetchReport(
        snapshot: TraeCredentialSnapshot,
        range: UsageDateRange
    ) async throws -> TraeUsageReport {
        let payload = try verifiedPayload(snapshot)
        async let usage = fetchUsage(
            payload: payload,
            variant: snapshot.variant,
            range: range
        )
        async let quota = fetchQuota(
            payload: payload,
            variant: snapshot.variant
        )
        return try await TraeUsageReport(usage: usage, quota: quota)
    }

    private func currentCredentials(
        for variant: TraeVariant
    ) throws -> (snapshot: TraeCredentialSnapshot, payload: TraeAuthPayload) {
        let url = storageURL(variant)
        guard FileManager.default.fileExists(atPath: url.path) else {
            throw TraeSupportError.storageMissing(variant)
        }
        return try TraeStorageCodec.readSnapshot(
            from: Data(contentsOf: url),
            variant: variant
        )
    }

    private func verifiedPayload(
        _ snapshot: TraeCredentialSnapshot
    ) throws -> TraeAuthPayload {
        let payload = try TraeStorageCodec.authPayload(from: snapshot.authBlob)
        guard payload.userID == snapshot.userID else {
            throw TraeSupportError.snapshotIdentityMismatch
        }
        return payload
    }

    private func fetchQuota(
        payload: TraeAuthPayload,
        variant: TraeVariant
    ) async throws -> TraeQuotaSummary {
        let baseURL = try TraeOfficialHostPolicy.baseURL(
            rawHost: payload.host,
            variant: variant
        )
        let data = try await post(
            paths: [
                "trae/api/v2/pay/ide_user_ent_usage",
                "trae/api/v1/pay/ide_user_ent_usage"
            ],
            body: ["require_usage": true],
            baseURL: baseURL,
            token: payload.token
        )
        return try TraeAPIParser.parseQuota(
            data,
            fallbackUserID: payload.userID,
            capturedAt: Date()
        )
    }

    private func fetchUsage(
        payload: TraeAuthPayload,
        variant: TraeVariant,
        range: UsageDateRange
    ) async throws -> UsageSnapshot {
        let baseURL = try TraeOfficialHostPolicy.baseURL(
            rawHost: payload.host,
            variant: variant
        )
        guard let queryBounds = usageQueryBounds(range: range) else {
            return .empty
        }
        var pageNumber = 1
        var expectedTotal: Int?
        var receivedRowCount = 0
        var records: [TraeUsageSessionRecord] = []

        while true {
            try Task.checkCancellation()
            let data = try await post(
                paths: ["trae/api/v1/pay/query_user_usage_group_by_session"],
                body: [
                    "start_time": queryBounds.startTime,
                    "end_time": queryBounds.endTime,
                    "page_size": usagePageSize,
                    "page_num": pageNumber
                ],
                baseURL: baseURL,
                token: payload.token
            )
            let page = try TraeAPIParser.parseUsagePage(data)
            guard page.invalidRowCount == 0 else {
                throw TraeSupportError.invalidUsageRows(page.invalidRowCount)
            }
            if page.hasExplicitTotal {
                if let expectedTotal, expectedTotal != page.total {
                    throw TraeSupportError.inconsistentUsageTotal(
                        expected: expectedTotal,
                        received: page.total
                    )
                }
                expectedTotal = page.total
            }
            receivedRowCount += page.rowCount
            records.append(contentsOf: page.records)

            if let expectedTotal {
                if receivedRowCount > expectedTotal {
                    throw TraeSupportError.inconsistentUsageTotal(
                        expected: expectedTotal,
                        received: receivedRowCount
                    )
                }
                if receivedRowCount == expectedTotal {
                    break
                }
            }
            if page.rowCount == 0 {
                if let expectedTotal, receivedRowCount < expectedTotal {
                    throw TraeSupportError.usagePaginationStalled
                }
                break
            }

            let needsAnotherPage: Bool
            if expectedTotal != nil {
                needsAnotherPage = true
            } else {
                needsAnotherPage = page.rowCount >= usagePageSize
            }
            guard needsAnotherPage else { break }
            guard pageNumber < paginationPageLimit else {
                throw TraeSupportError.usagePaginationLimitExceeded(
                    paginationPageLimit
                )
            }
            pageNumber += 1
        }
        return TraeUsageAggregator.aggregate(records, range: range)
    }

    private func usageQueryBounds(
        range: UsageDateRange,
        now: Date = Date()
    ) -> (startTime: Int64, endTime: Int64)? {
        let startInterval = max(
            range.startInclusive?.timeIntervalSince1970 ?? 0,
            0
        )
        let endInterval = max(
            min(range.endExclusive ?? now, now).timeIntervalSince1970,
            0
        )
        guard startInterval.isFinite, endInterval.isFinite else { return nil }
        let startTime = Int64(startInterval.rounded(.down))
        let endTime = Int64(endInterval.rounded(.up)) - 1
        guard endTime >= startTime else { return nil }
        return (startTime, endTime)
    }

    private func post(
        paths: [String],
        body: [String: Any],
        baseURL: URL,
        token: String
    ) async throws -> Data {
        guard
            !token.isEmpty,
            !token.contains("\r"),
            !token.contains("\n")
        else {
            throw TraeSupportError.invalidAuthentication
        }
        var lastStatus: Int?
        for (index, path) in paths.enumerated() {
            let url = path.split(separator: "/").reduce(baseURL) {
                $0.appendingPathComponent(String($1))
            }
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.timeoutInterval = 20
            request.setValue(
                "Cloud-IDE-JWT \(token)",
                forHTTPHeaderField: "Authorization"
            )
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            let (data, response) = try await client.data(for: request)
            guard let responseURL = response.url else {
                throw TraeSupportError.requestFailed(
                    "Trae 用量服务返回了无效响应。"
                )
            }
            try TraeOfficialHostPolicy.validateConnectionURL(responseURL)
            if (200..<300).contains(response.statusCode) {
                return data
            }
            if
                response.statusCode == 400,
                let page = try? TraeAPIParser.parseUsagePage(data),
                page.total == 0,
                page.rowCount == 0,
                page.records.isEmpty
            {
                return data
            }
            if response.statusCode == 401 || response.statusCode == 403 {
                throw TraeSupportError.requestFailed(
                    "Trae 登录已过期，请先打开对应 Trae 应用完成刷新后重试。"
                )
            }
            lastStatus = response.statusCode
            let canFallback = [400, 404, 405].contains(response.statusCode)
                && index < paths.count - 1
            if !canFallback {
                break
            }
        }
        throw TraeSupportError.requestFailed(
            "Trae 用量服务请求失败（HTTP \(lastStatus ?? 0)）。"
        )
    }
}

enum TraeAPIParser {
    static func parseQuota(
        _ data: Data,
        fallbackUserID: String,
        capturedAt: Date
    ) throws -> TraeQuotaSummary {
        let root = try JSONSerialization.jsonObject(with: data)
        let packs = entitlementPacks(in: root)
        guard !packs.isEmpty else {
            throw TraeSupportError.requestFailed("Trae 额度响应中没有可识别的套餐。")
        }

        var used = 0.0
        var finiteTotal = 0.0
        var payGoUsed = 0.0
        var isUnlimited = false
        var requestUsed = 0.0
        var requestTotal = 0.0
        var requestUnlimited = false
        var hasCreditFields = false
        var selected: (priority: Int, type: Int, pack: [String: Any])?
        var sourceUserID = fallbackUserID

        for pack in packs {
            let base = dictionary(pack["entitlement_base_info"]) ?? pack
            let quota = dictionary(base["quota"])
                ?? dictionary(pack["quota"])
                ?? [:]
            let usage = dictionary(pack["usage"]) ?? [:]
            let basicLimit = number(quota["basic_usage_limit"]) ?? 0
            let bonusLimit = number(quota["bonus_usage_limit"]) ?? 0
            let basicUsed = max(number(usage["basic_usage_amount"]) ?? 0, 0)
            let bonusUsed = max(number(usage["bonus_usage_amount"]) ?? 0, 0)
            hasCreditFields = hasCreditFields
                || quota["basic_usage_limit"] != nil
                || quota["bonus_usage_limit"] != nil
                || usage["basic_usage_amount"] != nil
                || usage["bonus_usage_amount"] != nil
            used += basicUsed + bonusUsed
            payGoUsed += max(number(usage["pay_go_amount"]) ?? 0, 0)
            if basicLimit < 0 || bonusLimit < 0 {
                isUnlimited = true
            } else {
                finiteTotal += max(basicLimit, 0) + max(bonusLimit, 0)
            }
            let fastLimit = number(quota["premium_model_fast_request_limit"]) ?? 0
            let fastUsed = max(number(usage["premium_model_fast_amount"]) ?? 0, 0)
            requestUsed += fastUsed
            if fastLimit < 0 {
                requestUnlimited = true
            } else {
                requestTotal += max(fastLimit, 0)
            }

            if let userID = string(base["user_id"]), !userID.isEmpty {
                sourceUserID = userID
            }
            let productType = integer(base["product_type"]) ?? 0
            let priority = productPriority(productType)
            if selected == nil || priority > selected!.priority {
                selected = (priority, productType, pack)
            }
        }

        guard let selected else {
            throw TraeSupportError.requestFailed("Trae 额度响应中没有可识别的套餐。")
        }
        let selectedBase = dictionary(
            selected.pack["entitlement_base_info"]
        ) ?? selected.pack
        let cycleStart = date(selectedBase["start_time"])
            ?? date(selected.pack["start_time"])
        let reset = date(selected.pack["next_billing_time"])
            ?? date(selected.pack["expire_time"])
            ?? date(selectedBase["end_time"])
        let usesCredits = hasCreditFields
            && (
                used > 0
                    || finiteTotal > 0
                    || isUnlimited
                    || payGoUsed > 0
                    || requestTotal == 0
            )
        let reportedUsed = usesCredits ? used : requestUsed
        let reportedTotal: Double? = usesCredits
            ? (isUnlimited ? nil : finiteTotal)
            : (requestUnlimited ? nil : requestTotal)
        return TraeQuotaSummary(
            sourceUserID: sourceUserID,
            used: reportedUsed,
            total: reportedTotal,
            payGoUsed: payGoUsed,
            unit: usesCredits ? .credits : .requests,
            packageName: productName(selected.type),
            cycleStartsAt: cycleStart,
            resetsAt: reset,
            capturedAt: capturedAt
        )
    }

    static func parseUsagePage(_ data: Data) throws -> TraeUsagePage {
        let root = try JSONSerialization.jsonObject(with: data)
        guard let rows = firstArray(
            in: root,
            keys: [
                "user_usage_group_by_sessions",
                "usage_group_by_sessions",
                "session_usage_list"
            ]
        ) else {
            throw TraeSupportError.requestFailed("Trae 用量响应格式无法识别。")
        }
        let explicitTotal = firstNumber(
            in: root,
            keys: ["total", "total_count"]
        ).flatMap(nonnegativeInteger)
        let total = explicitTotal ?? rows.count
        let records = rows.compactMap { element -> TraeUsageSessionRecord? in
            guard let row = dictionary(element) else { return nil }
            let extra = dictionary(row["extra_info"]) ?? [:]
            guard
                let sessionID = string(row["session_id"]),
                !sessionID.isEmpty,
                let timestamp = date(row["usage_time"])
            else {
                return nil
            }
            let input = safeTokenCount(extra["input_token"])
            let output = safeTokenCount(extra["output_token"])
            let cacheRead = safeTokenCount(extra["cache_read_token"])
            let cacheWrite = safeTokenCount(extra["cache_write_token"])
            return TraeUsageSessionRecord(
                sessionID: sessionID,
                timestamp: timestamp,
                model: string(row["model_name"]) ?? "Unknown",
                mode: string(row["mode"]) ?? "",
                tokens: TokenBreakdown(
                    input: input,
                    output: output,
                    cacheRead: cacheRead,
                    cacheWrite: cacheWrite,
                    reasoning: 0,
                    requestCount: 1
                ),
                credits: max(number(row["amount_float"]) ?? 0, 0),
                cost: max(
                    number(row["cost_money_float"])
                        ?? number(row["dollar_float"])
                        ?? 0,
                    0
                )
            )
        }
        return TraeUsagePage(
            total: total,
            hasExplicitTotal: explicitTotal != nil,
            rowCount: rows.count,
            invalidRowCount: rows.count - records.count,
            records: records
        )
    }

    private static func entitlementPacks(in value: Any) -> [[String: Any]] {
        var result: [[String: Any]] = []
        collectEntitlementPacks(value, into: &result)
        return result
    }

    private static func collectEntitlementPacks(
        _ value: Any,
        into result: inout [[String: Any]]
    ) {
        if let object = dictionary(value) {
            if object["entitlement_base_info"] != nil, object["usage"] != nil {
                result.append(object)
                return
            }
            for child in object.values {
                collectEntitlementPacks(child, into: &result)
            }
        } else if let array = value as? [Any] {
            for child in array {
                collectEntitlementPacks(child, into: &result)
            }
        }
    }

    private static func firstArray(in value: Any, keys: Set<String>) -> [Any]? {
        if let object = dictionary(value) {
            for key in keys {
                if let array = object[key] as? [Any] {
                    return array
                }
            }
            for child in object.values {
                if let found = firstArray(in: child, keys: keys) {
                    return found
                }
            }
        } else if let array = value as? [Any] {
            for child in array {
                if let found = firstArray(in: child, keys: keys) {
                    return found
                }
            }
        }
        return nil
    }

    private static func firstNumber(in value: Any, keys: Set<String>) -> Double? {
        if let object = dictionary(value) {
            for key in keys {
                if let value = number(object[key]) {
                    return value
                }
            }
            for child in object.values {
                if let found = firstNumber(in: child, keys: keys) {
                    return found
                }
            }
        } else if let array = value as? [Any] {
            for child in array {
                if let found = firstNumber(in: child, keys: keys) {
                    return found
                }
            }
        }
        return nil
    }

    private static func productPriority(_ type: Int) -> Int {
        switch type {
        case 6: return 60 // Ultra
        case 4, 5: return 50 // Pro Plus
        case 1: return 40 // Pro
        case 8: return 30 // Lite
        case 100: return 20 // CN Express
        case 2, 3, 7, 9: return 10
        default: return 0
        }
    }

    private static func productName(_ type: Int) -> String {
        switch type {
        case 0: return "Free"
        case 1: return "Pro"
        case 2: return "Package"
        case 3: return "Promo Code"
        case 4, 5: return "Pro Plus"
        case 6: return "Ultra"
        case 7: return "Pay As You Go"
        case 8: return "Lite"
        case 9: return "Solo Invite"
        case 100: return "CN Express"
        default: return "Trae"
        }
    }

    private static func safeTokenCount(_ value: Any?) -> Int {
        guard let number = number(value), number.isFinite, number > 0 else {
            return 0
        }
        return Int(min(number.rounded(), Double(Int.max)))
    }

    private static func dictionary(_ value: Any?) -> [String: Any]? {
        value as? [String: Any]
    }

    private static func string(_ value: Any?) -> String? {
        if let value = value as? String {
            return value
        }
        if let value = value as? NSNumber {
            return value.stringValue
        }
        return nil
    }

    private static func number(_ value: Any?) -> Double? {
        let result: Double?
        if let number = value as? NSNumber {
            result = number.doubleValue
        } else if let string = value as? String {
            result = Double(string)
        } else {
            result = nil
        }
        guard let result, result.isFinite else { return nil }
        return result
    }

    private static func integer(_ value: Any?) -> Int? {
        guard
            let value = number(value),
            value >= Double(Int.min),
            value <= Double(Int.max)
        else {
            return nil
        }
        return Int(value)
    }

    private static func nonnegativeInteger(_ value: Double) -> Int? {
        guard value >= 0, value <= Double(Int.max), value.isFinite else {
            return nil
        }
        return Int(value)
    }

    private static func date(_ value: Any?) -> Date? {
        if let numeric = number(value) {
            let seconds = numeric > 10_000_000_000 ? numeric / 1_000 : numeric
            guard seconds > 0 else { return nil }
            return Date(timeIntervalSince1970: seconds)
        }
        guard let value = value as? String else { return nil }
        if let numeric = Double(value) {
            return date(numeric)
        }
        return ISO8601DateFormatter().date(from: value)
    }
}

enum TraeUsageAggregator {
    private struct Bucket {
        var tokens = TokenBreakdown()
        var credits = 0.0
    }

    private struct SessionBucket {
        var title: String
        var tokens = TokenBreakdown()
        var credits = 0.0
        var lastActivity: Date
    }

    static func aggregate(
        _ records: [TraeUsageSessionRecord],
        range: UsageDateRange,
        calendar: Calendar = .current,
        capturedAt: Date = Date()
    ) -> UsageSnapshot {
        var seen = Set<String>()
        var total = TokenBreakdown()
        var credits = 0.0
        var daily: [Date: Bucket] = [:]
        var hourly: [Date: Bucket] = [:]
        var modelDaily: [String: Bucket] = [:]
        var modelHourly: [String: Bucket] = [:]
        var sessions: [String: SessionBucket] = [:]
        var models: [String: Bucket] = [:]
        var accepted = 0

        for record in records where range.contains(record.timestamp) {
            let key = [
                record.sessionID,
                String(record.timestamp.timeIntervalSince1970),
                record.model,
                record.mode,
                String(record.tokens.input),
                String(record.tokens.output),
                String(record.tokens.cacheRead),
                String(record.tokens.cacheWrite),
                String(record.credits)
            ].joined(separator: "|")
            guard seen.insert(key).inserted else { continue }
            accepted += 1
            total = total + record.tokens
            credits += record.credits

            let day = calendar.startOfDay(for: record.timestamp)
            let hour = calendar.dateInterval(
                of: .hour,
                for: record.timestamp
            )?.start ?? record.timestamp
            add(record, to: day, in: &daily)
            add(record, to: hour, in: &hourly)
            add(record, to: modelKey(date: day, model: record.model), in: &modelDaily)
            add(record, to: modelKey(date: hour, model: record.model), in: &modelHourly)
            add(record, to: record.model, in: &models)

            let title = record.mode.isEmpty
                ? record.model
                : "\(record.mode) · \(record.model)"
            var session = sessions[record.sessionID] ?? SessionBucket(
                title: title,
                lastActivity: record.timestamp
            )
            session.tokens = session.tokens + record.tokens
            session.credits += record.credits
            if record.timestamp >= session.lastActivity {
                session.lastActivity = record.timestamp
                session.title = title
            }
            sessions[record.sessionID] = session
        }

        return UsageSnapshot(
            total: total,
            credits: credits,
            daily: daily.map {
                DailyUsagePoint(
                    day: $0.key,
                    breakdown: $0.value.tokens,
                    credits: $0.value.credits
                )
            }.sorted { $0.day < $1.day },
            hourly: hourly.map {
                HourlyUsagePoint(
                    hour: $0.key,
                    breakdown: $0.value.tokens,
                    credits: $0.value.credits
                )
            }.sorted { $0.hour < $1.hour },
            modelDaily: modelDaily.compactMap {
                guard let components = splitModelKey($0.key) else { return nil }
                return ModelDailyUsagePoint(
                    day: components.date,
                    model: components.model,
                    tokens: $0.value.tokens,
                    credits: $0.value.credits
                )
            }.sorted {
                $0.day == $1.day ? $0.model < $1.model : $0.day < $1.day
            },
            modelHourly: modelHourly.compactMap {
                guard let components = splitModelKey($0.key) else { return nil }
                return ModelHourlyUsagePoint(
                    hour: components.date,
                    model: components.model,
                    tokens: $0.value.tokens,
                    credits: $0.value.credits
                )
            }.sorted {
                $0.hour == $1.hour ? $0.model < $1.model : $0.hour < $1.hour
            },
            sessions: sessions.map {
                SessionUsageSummary(
                    sessionID: $0.key,
                    title: $0.value.title,
                    tokens: $0.value.tokens,
                    credits: $0.value.credits,
                    lastActivity: $0.value.lastActivity
                )
            }.sorted { $0.lastActivity > $1.lastActivity },
            models: models.map {
                ModelUsageSummary(
                    model: $0.key,
                    tokens: $0.value.tokens,
                    credits: $0.value.credits
                )
            }.sorted {
                if $0.credits == $1.credits {
                    return $0.tokens.total > $1.tokens.total
                }
                return $0.credits > $1.credits
            },
            scannedFiles: accepted,
            capturedAt: capturedAt
        )
    }

    private static func add<Key: Hashable>(
        _ record: TraeUsageSessionRecord,
        to key: Key,
        in buckets: inout [Key: Bucket]
    ) {
        var bucket = buckets[key] ?? Bucket()
        bucket.tokens = bucket.tokens + record.tokens
        bucket.credits += record.credits
        buckets[key] = bucket
    }

    private static func modelKey(date: Date, model: String) -> String {
        "\(date.timeIntervalSinceReferenceDate)|\(model)"
    }

    private static func splitModelKey(_ value: String) -> (date: Date, model: String)? {
        guard
            let separator = value.firstIndex(of: "|"),
            let interval = Double(value[..<separator])
        else {
            return nil
        }
        let modelStart = value.index(after: separator)
        return (
            Date(timeIntervalSinceReferenceDate: interval),
            String(value[modelStart...])
        )
    }
}
