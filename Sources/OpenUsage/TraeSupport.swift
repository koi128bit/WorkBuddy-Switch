import AppKit
import Combine
import CommonCrypto
import CryptoKit
import Darwin
import Foundation
import Security

enum TraeVariant: String, CaseIterable, Codable, Identifiable, Sendable {
    case china
    case work

    var id: String { rawValue }

    var provider: ManagedProvider {
        switch self {
        case .china: return .traeCN
        case .work: return .traeWork
        }
    }

    var displayName: String {
        switch self {
        case .china: return "Trae CN"
        case .work: return "TRAE Work"
        }
    }

    var bundleIdentifiers: [String] {
        switch self {
        case .china:
            return ["cn.trae.app"]
        case .work:
            // TRAE Work is distributed as TRAE SOLO. The CN bundle is kept as
            // a compatibility candidate for the currently shipped SOLO build.
            return ["com.trae.solo.app", "cn.trae.solo.app"]
        }
    }

    var applicationNames: [String] {
        switch self {
        case .china:
            return ["Trae CN.app"]
        case .work:
            return ["TRAE SOLO.app", "TRAE Work.app", "TRAE SOLO CN.app"]
        }
    }

    var supportDirectoryNames: [String] {
        switch self {
        case .china:
            return ["Trae CN"]
        case .work:
            return ["TRAE SOLO", "TRAE SOLO CN"]
        }
    }

    var defaultAPIBaseURL: URL {
        switch self {
        case .china:
            return URL(string: "https://api.trae.cn")!
        case .work:
            return URL(string: "https://grow-normal.trae.ai")!
        }
    }
}

extension ManagedProvider {
    var traeVariant: TraeVariant? {
        switch self {
        case .workBuddy: return nil
        case .traeCN: return .china
        case .traeWork: return .work
        }
    }
}

enum TraeSupportError: LocalizedError, Sendable {
    case applicationNotInstalled(TraeVariant)
    case storageMissing(TraeVariant)
    case invalidStorage
    case authenticationMissing
    case invalidAuthentication
    case authenticationIntegrityFailed
    case snapshotVariantMismatch
    case snapshotIdentityMismatch
    case accountSnapshotMissing
    case unsafeAPIHost
    case invalidUsageRows(Int)
    case inconsistentUsageTotal(expected: Int, received: Int)
    case usagePaginationLimitExceeded(Int)
    case usagePaginationStalled
    case requestFailed(String)
    case keychain(String)
    case fileOperation(String)
    case switchInProgress

    var errorDescription: String? {
        switch self {
        case .applicationNotInstalled(let variant):
            return "未找到 \(variant.displayName)，请先安装并登录。"
        case .storageMissing(let variant):
            return "未找到 \(variant.displayName) 登录数据，请先启动应用并完成登录。"
        case .invalidStorage:
            return "Trae 登录数据格式无法识别。"
        case .authenticationMissing:
            return "Trae 当前没有可用的登录信息。"
        case .invalidAuthentication:
            return "Trae 登录信息无法解密或字段不完整。"
        case .authenticationIntegrityFailed:
            return "Trae 登录信息完整性校验失败。"
        case .snapshotVariantMismatch:
            return "该账号快照属于另一个 Trae 版本，不能跨版本使用。"
        case .snapshotIdentityMismatch:
            return "钥匙串快照身份与所选账号不匹配，请重新登录并保存。"
        case .accountSnapshotMissing:
            return "该 Trae 账号没有可用的安全快照，请重新登录并保存。"
        case .unsafeAPIHost:
            return "Trae 登录信息中的服务地址不在官方安全列表内，已停止发送凭据。"
        case .invalidUsageRows(let count):
            return "Trae 用量响应包含 \(count) 条无法识别的记录，未返回可能不完整的统计结果。"
        case .inconsistentUsageTotal(let expected, let received):
            return "Trae 用量响应的记录总数不一致（声明 \(expected) 条，已收到 \(received) 条），未返回可能不完整的统计结果。"
        case .usagePaginationLimitExceeded(let pageLimit):
            return "Trae 用量记录超过安全分页上限（\(pageLimit) 页），未返回可能不完整的统计结果。"
        case .usagePaginationStalled:
            return "Trae 用量分页在读取完整记录前停止返回数据，未返回可能不完整的统计结果。"
        case .requestFailed(let message):
            return message
        case .keychain(let message):
            return "钥匙串操作失败：\(message)"
        case .fileOperation(let message):
            return message
        case .switchInProgress:
            return "已有 Trae 账号切换正在进行，请稍候。"
        }
    }
}

struct TraeDataLocation: Hashable, Sendable {
    let variant: TraeVariant
    let rootURL: URL

    var storageURL: URL {
        rootURL
            .appendingPathComponent("User", isDirectory: true)
            .appendingPathComponent("globalStorage", isDirectory: true)
            .appendingPathComponent("storage.json")
    }

    static func resolve(
        _ variant: TraeVariant,
        homeURL: URL = FileManager.default.homeDirectoryForCurrentUser,
        fileManager: FileManager = .default
    ) -> TraeDataLocation {
        let applicationSupport = homeURL
            .appendingPathComponent("Library", isDirectory: true)
            .appendingPathComponent("Application Support", isDirectory: true)
        let candidates = variant.supportDirectoryNames.map {
            applicationSupport.appendingPathComponent($0, isDirectory: true)
        }
        let selected = candidates.first {
            fileManager.fileExists(
                atPath: $0
                    .appendingPathComponent("User/globalStorage/storage.json")
                    .path
            )
        } ?? candidates[0]
        return TraeDataLocation(variant: variant, rootURL: selected)
    }
}

struct TraeAuthPayload: Hashable, Sendable {
    let token: String
    let refreshToken: String?
    let userID: String
    let host: String?
    let userRegion: String?
    let displayName: String?
    let email: String?
    let avatarURL: String?
    let expiredAt: String?
    let refreshExpiredAt: String?
}

struct TraeCredentialSnapshot: Codable, Hashable, Sendable {
    let variant: TraeVariant
    let userID: String
    let authBlob: String
    let userTagBlob: String?
    let deviceAuthBlobs: [String: String]
    let capturedAt: Date

    var keychainAccount: String {
        "\(variant.rawValue):\(userID)"
    }
}

struct TraeAccountProfile: Codable, Hashable, Identifiable, Sendable {
    let variant: TraeVariant
    let userID: String
    var nickname: String
    var email: String?
    var avatarURL: String?
    var capturedAt: Date
    var lastUsedAt: Date

    var id: String { "\(variant.rawValue):\(userID)" }

    var shortID: String {
        guard userID.count > 12 else { return userID }
        return "\(userID.prefix(7))...\(userID.suffix(4))"
    }

    var initials: String {
        let trimmed = nickname.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.first.map { String($0).uppercased() }
            ?? String(userID.prefix(1)).uppercased()
    }
}

enum TraeByteCrypto {
    static let header = Data([116, 99, 5, 16, 0, 0])

    private static let staticSecret = Data(hex:
        """
        4dd4c2e6b83162090e52b3c7a6733ba41cb2462b829ab58a196b39db57177524
        f49baf7f08e8d68d26a72e37c1a95a2f1f05a51892aef2949732b62a38aadd58
        """
    )!

    static func decrypt(_ encoded: String) throws -> Data {
        guard let blob = Data(base64Encoded: encoded, options: .ignoreUnknownCharacters) else {
            throw TraeSupportError.invalidAuthentication
        }
        let minimumLength = header.count + 32 + kCCBlockSizeAES128
        guard
            blob.count >= minimumLength,
            blob.prefix(header.count) == header
        else {
            throw TraeSupportError.invalidAuthentication
        }

        let randomKeyRange = header.count..<(header.count + 32)
        let encryptedStart = randomKeyRange.upperBound
        let randomKey = Data(blob[randomKeyRange])
        let encrypted = Data(blob[encryptedStart...])
        let material = deriveMaterial(randomKey: randomKey)
        let plain = try crypt(
            operation: CCOperation(kCCDecrypt),
            input: encrypted,
            key: Data(material.prefix(16)),
            iv: Data(material.dropFirst(16).prefix(16))
        )
        guard plain.count >= 64 else {
            throw TraeSupportError.invalidAuthentication
        }

        let expectedDigest = Data(plain.prefix(64))
        let payload = Data(plain.dropFirst(64))
        let actualDigest = Data(SHA512.hash(data: payload))
        guard timingSafeEqual(expectedDigest, actualDigest) else {
            throw TraeSupportError.authenticationIntegrityFailed
        }
        return payload
    }

    static func decodeJSON(_ value: String) throws -> [String: Any] {
        let data: Data
        if value.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("{") {
            guard let plain = value.data(using: .utf8) else {
                throw TraeSupportError.invalidAuthentication
            }
            data = plain
        } else {
            data = try decrypt(value)
        }
        guard
            let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            throw TraeSupportError.invalidAuthentication
        }
        return object
    }

    // Synthetic fixtures use this helper. Production switching always preserves
    // Trae's opaque blobs and never re-encrypts credentials.
    static func encodeForTesting(_ payload: Data, randomKey: Data) throws -> String {
        guard randomKey.count == 32 else {
            throw TraeSupportError.invalidAuthentication
        }
        var authenticated = Data(SHA512.hash(data: payload))
        authenticated.append(payload)
        let material = deriveMaterial(randomKey: randomKey)
        let encrypted = try crypt(
            operation: CCOperation(kCCEncrypt),
            input: authenticated,
            key: Data(material.prefix(16)),
            iv: Data(material.dropFirst(16).prefix(16))
        )
        var blob = header
        blob.append(randomKey)
        blob.append(encrypted)
        return blob.base64EncodedString()
    }

    private static func deriveMaterial(randomKey: Data) -> Data {
        var seed = Data(SHA512.hash(data: randomKey))
        seed.append(staticSecret)
        return Data(SHA512.hash(data: seed))
    }

    private static func crypt(
        operation: CCOperation,
        input: Data,
        key: Data,
        iv: Data
    ) throws -> Data {
        let outputCapacity = input.count + kCCBlockSizeAES128
        var output = Data(count: outputCapacity)
        var outputLength = 0
        let status = output.withUnsafeMutableBytes { outputBytes in
            input.withUnsafeBytes { inputBytes in
                key.withUnsafeBytes { keyBytes in
                    iv.withUnsafeBytes { ivBytes in
                        CCCrypt(
                            operation,
                            CCAlgorithm(kCCAlgorithmAES),
                            CCOptions(kCCOptionPKCS7Padding),
                            keyBytes.baseAddress,
                            key.count,
                            ivBytes.baseAddress,
                            inputBytes.baseAddress,
                            input.count,
                            outputBytes.baseAddress,
                            outputCapacity,
                            &outputLength
                        )
                    }
                }
            }
        }
        guard status == kCCSuccess else {
            throw TraeSupportError.invalidAuthentication
        }
        output.removeSubrange(outputLength..<output.count)
        return output
    }

    private static func timingSafeEqual(_ lhs: Data, _ rhs: Data) -> Bool {
        guard lhs.count == rhs.count else { return false }
        var difference: UInt8 = 0
        for index in lhs.indices {
            difference |= lhs[index] ^ rhs[index]
        }
        return difference == 0
    }
}

enum TraeStorageCodec {
    static let authKey = "iCubeAuthInfo://icube.cloudide"
    static let userTagKey = "iCubeAuthInfo://usertag"
    static let serverDataKey = "iCubeServerData://icube.cloudide"
    static let deviceAuthPrefix = "iCubeAuthInfo://icube-dc:"

    static func readSnapshot(
        from data: Data,
        variant: TraeVariant,
        capturedAt: Date = Date()
    ) throws -> (snapshot: TraeCredentialSnapshot, payload: TraeAuthPayload) {
        let object = try storageObject(from: data)
        guard let authBlob = object[authKey] as? String, !authBlob.isEmpty else {
            throw TraeSupportError.authenticationMissing
        }
        let payload = try authPayload(from: authBlob)
        let deviceBlobs = object.reduce(into: [String: String]()) { result, item in
            guard
                item.key.hasPrefix(deviceAuthPrefix),
                let value = item.value as? String
            else {
                return
            }
            result[item.key] = value
        }
        let snapshot = TraeCredentialSnapshot(
            variant: variant,
            userID: payload.userID,
            authBlob: authBlob,
            userTagBlob: object[userTagKey] as? String,
            deviceAuthBlobs: deviceBlobs,
            capturedAt: capturedAt
        )
        return (snapshot, payload)
    }

    static func replacingAuthentication(
        in data: Data,
        with snapshot: TraeCredentialSnapshot,
        variant: TraeVariant
    ) throws -> Data {
        guard snapshot.variant == variant else {
            throw TraeSupportError.snapshotVariantMismatch
        }
        let payload = try authPayload(from: snapshot.authBlob)
        guard payload.userID == snapshot.userID else {
            throw TraeSupportError.snapshotIdentityMismatch
        }

        var object = try storageObject(from: data)
        object.removeValue(forKey: authKey)
        object.removeValue(forKey: userTagKey)
        object.removeValue(forKey: serverDataKey)
        for key in object.keys where key.hasPrefix(deviceAuthPrefix) {
            object.removeValue(forKey: key)
        }

        object[authKey] = snapshot.authBlob
        if let userTagBlob = snapshot.userTagBlob {
            object[userTagKey] = userTagBlob
        }
        for (key, value) in snapshot.deviceAuthBlobs where key.hasPrefix(deviceAuthPrefix) {
            object[key] = value
        }

        guard JSONSerialization.isValidJSONObject(object) else {
            throw TraeSupportError.invalidStorage
        }
        return try JSONSerialization.data(
            withJSONObject: object,
            options: [.prettyPrinted, .sortedKeys]
        )
    }

    static func authPayload(from authBlob: String) throws -> TraeAuthPayload {
        let object = try TraeByteCrypto.decodeJSON(authBlob)
        guard
            let token = nonemptyString(in: object, keys: ["token", "accessToken"]),
            let userID = nonemptyString(in: object, keys: ["userId", "userID", "user_id"])
        else {
            throw TraeSupportError.invalidAuthentication
        }
        let account = object["account"] as? [String: Any] ?? [:]
        return TraeAuthPayload(
            token: token,
            refreshToken: nonemptyString(
                in: object,
                keys: ["refreshToken", "refresh_token"]
            ),
            userID: userID,
            host: nonemptyString(in: object, keys: ["host"]),
            userRegion: nonemptyString(in: object, keys: ["userRegion", "region"]),
            displayName: nonemptyString(
                in: account,
                keys: ["name", "screenName", "screen_name", "nickname", "username"]
            ),
            email: nonemptyString(
                in: account,
                keys: ["email", "emailAddress", "email_address"]
            ),
            avatarURL: nonemptyString(
                in: account,
                keys: ["avatar", "avatarUrl", "avatarURL", "avatar_url"]
            ),
            expiredAt: scalarString(
                in: object,
                keys: ["expiredAt", "expired_at"]
            ),
            refreshExpiredAt: scalarString(
                in: object,
                keys: ["refreshExpiredAt", "refresh_expired_at"]
            )
        )
    }

    private static func storageObject(from data: Data) throws -> [String: Any] {
        guard
            let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            throw TraeSupportError.invalidStorage
        }
        return object
    }

    private static func nonemptyString(
        in object: [String: Any],
        keys: [String]
    ) -> String? {
        for key in keys {
            if let value = object[key] as? String {
                let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty {
                    return trimmed
                }
            }
        }
        return nil
    }

    private static func scalarString(
        in object: [String: Any],
        keys: [String]
    ) -> String? {
        for key in keys {
            if let value = object[key] as? String {
                return value
            }
            if let value = object[key] as? NSNumber {
                return value.stringValue
            }
        }
        return nil
    }
}

protocol TraeCredentialVaulting {
    func save(_ snapshot: TraeCredentialSnapshot) throws
    func load(variant: TraeVariant, userID: String) throws -> TraeCredentialSnapshot
    func delete(variant: TraeVariant, userID: String) throws
}

struct TraeCredentialVault: TraeCredentialVaulting {
    private let service = "com.koi128bit.openusage.trae-account.v1"
    private let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }()
    private let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()

    func save(_ snapshot: TraeCredentialSnapshot) throws {
        let data = try encoder.encode(snapshot)
        let account = snapshot.keychainAccount
        let key: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]
        let updateStatus = SecItemUpdate(key as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess { return }
        guard updateStatus == errSecItemNotFound else {
            throw TraeSupportError.keychain(message(for: updateStatus))
        }

        var insert = key
        attributes.forEach { insert[$0.key] = $0.value }
        let addStatus = SecItemAdd(insert as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw TraeSupportError.keychain(message(for: addStatus))
        }
    }

    func load(variant: TraeVariant, userID: String) throws -> TraeCredentialSnapshot {
        let account = "\(variant.rawValue):\(userID)"
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else {
            if status == errSecItemNotFound {
                throw TraeSupportError.accountSnapshotMissing
            }
            throw TraeSupportError.keychain(message(for: status))
        }
        let snapshot = try decoder.decode(TraeCredentialSnapshot.self, from: data)
        guard snapshot.variant == variant, snapshot.userID == userID else {
            throw TraeSupportError.snapshotIdentityMismatch
        }
        return snapshot
    }

    func delete(variant: TraeVariant, userID: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: "\(variant.rawValue):\(userID)"
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw TraeSupportError.keychain(message(for: status))
        }
    }

    private func message(for status: OSStatus) -> String {
        SecCopyErrorMessageString(status, nil) as String? ?? "OSStatus \(status)"
    }
}

@MainActor
protocol TraeApplicationControlling {
    func applicationURL(for variant: TraeVariant) -> URL?
    func isRunning(_ variant: TraeVariant) -> Bool
    func stop(_ variant: TraeVariant) async throws
    func launch(_ variant: TraeVariant) async throws
}

@MainActor
final class TraeApplicationController: TraeApplicationControlling {
    func applicationURL(for variant: TraeVariant) -> URL? {
        for identifier in variant.bundleIdentifiers {
            if let url = NSWorkspace.shared.urlForApplication(
                withBundleIdentifier: identifier
            ) {
                return url
            }
        }

        let fileManager = FileManager.default
        let roots = [
            URL(fileURLWithPath: "/Applications", isDirectory: true),
            fileManager.homeDirectoryForCurrentUser
                .appendingPathComponent("Applications", isDirectory: true)
        ]
        for root in roots {
            for name in variant.applicationNames {
                let candidate = root.appendingPathComponent(name, isDirectory: true)
                if fileManager.fileExists(atPath: candidate.path) {
                    return candidate
                }
            }
        }
        return nil
    }

    func isRunning(_ variant: TraeVariant) -> Bool {
        !runningApplications(for: variant).isEmpty
    }

    func stop(_ variant: TraeVariant) async throws {
        var applications = runningApplications(for: variant)
        guard !applications.isEmpty else { return }
        applications.forEach { _ = $0.terminate() }

        for _ in 0..<50 {
            try Task.checkCancellation()
            try await Task.sleep(nanoseconds: 100_000_000)
            applications = runningApplications(for: variant)
            if applications.isEmpty {
                return
            }
        }

        applications.forEach { _ = $0.forceTerminate() }
        for _ in 0..<20 {
            try Task.checkCancellation()
            try await Task.sleep(nanoseconds: 100_000_000)
            if runningApplications(for: variant).isEmpty {
                return
            }
        }
        throw TraeSupportError.requestFailed(
            "无法停止 \(variant.displayName)，请手动退出后重试。"
        )
    }

    func launch(_ variant: TraeVariant) async throws {
        guard let url = applicationURL(for: variant) else {
            throw TraeSupportError.applicationNotInstalled(variant)
        }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        try await withCheckedThrowingContinuation {
            (continuation: CheckedContinuation<Void, Error>) in
            NSWorkspace.shared.openApplication(
                at: url,
                configuration: configuration
            ) { _, error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume()
                }
            }
        }
    }

    private func runningApplications(
        for variant: TraeVariant
    ) -> [NSRunningApplication] {
        var seen = Set<pid_t>()
        return variant.bundleIdentifiers.flatMap {
            NSRunningApplication.runningApplications(withBundleIdentifier: $0)
        }.filter {
            seen.insert($0.processIdentifier).inserted
        }
    }
}

enum TraeAtomicFile {
    static func write(
        _ data: Data,
        to destinationURL: URL,
        preserving attributes: [FileAttributeKey: Any]? = nil,
        fileManager: FileManager = .default
    ) throws {
        let directory = destinationURL.deletingLastPathComponent()
        try fileManager.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        let temporaryURL = directory.appendingPathComponent(
            ".workbuddy-switch-trae-\(UUID().uuidString).tmp"
        )
        defer { try? fileManager.removeItem(at: temporaryURL) }

        do {
            try data.write(to: temporaryURL, options: .withoutOverwriting)
            let permissions = attributes?[.posixPermissions] ?? 0o600
            try fileManager.setAttributes(
                [.posixPermissions: permissions],
                ofItemAtPath: temporaryURL.path
            )
            let descriptor = open(temporaryURL.path, O_RDONLY)
            if descriptor >= 0 {
                _ = fsync(descriptor)
                _ = close(descriptor)
            }
            let status: Int32 = temporaryURL.withUnsafeFileSystemRepresentation { source in
                destinationURL.withUnsafeFileSystemRepresentation { destination in
                    guard let source, let destination else { return Int32(-1) }
                    return Darwin.rename(source, destination)
                }
            }
            guard status == 0 else {
                throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
            }
        } catch {
            throw TraeSupportError.fileOperation(
                "无法原子写入 Trae 登录数据：\(error.localizedDescription)"
            )
        }
    }
}

@MainActor
final class TraeAccountStore: ObservableObject {
    @Published private(set) var accounts: [TraeAccountProfile] = []
    @Published private(set) var currentUserIDs: [TraeVariant: String] = [:]
    @Published private(set) var switchingVariant: TraeVariant?

    private struct PersistedIndex: Codable {
        let version: Int
        let accounts: [TraeAccountProfile]
    }

    private let indexURL: URL
    private let vault: any TraeCredentialVaulting
    private let controller: any TraeApplicationControlling
    private let storageURL: (TraeVariant) -> URL
    private let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }()
    private let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()

    init(
        indexURL: URL = AppPaths.appSupport.appendingPathComponent(
            "trae-accounts.json"
        ),
        vault: any TraeCredentialVaulting = TraeCredentialVault(),
        controller: (any TraeApplicationControlling)? = nil,
        storageURL: @escaping (TraeVariant) -> URL = {
            TraeDataLocation.resolve($0).storageURL
        }
    ) {
        self.indexURL = indexURL
        self.vault = vault
        self.controller = controller ?? TraeApplicationController()
        self.storageURL = storageURL
        loadIndex()
        refreshCurrentAccounts()
    }

    func accounts(for variant: TraeVariant) -> [TraeAccountProfile] {
        accounts.filter { $0.variant == variant }
    }

    func currentUserID(for variant: TraeVariant) -> String? {
        currentUserIDs[variant]
    }

    func currentAccount(for variant: TraeVariant) -> TraeAccountProfile? {
        guard let userID = currentUserID(for: variant) else { return nil }
        return accounts.first { $0.variant == variant && $0.userID == userID }
    }

    func isSwitching(_ variant: TraeVariant) -> Bool {
        switchingVariant == variant
    }

    func applicationURL(for variant: TraeVariant) -> URL? {
        controller.applicationURL(for: variant)
    }

    func refreshCurrentAccounts() {
        guard switchingVariant == nil else { return }
        var refreshed: [TraeVariant: String] = [:]
        for variant in TraeVariant.allCases {
            let url = storageURL(variant)
            guard
                let data = try? Data(contentsOf: url),
                let result = try? TraeStorageCodec.readSnapshot(
                    from: data,
                    variant: variant
                )
            else {
                continue
            }
            refreshed[variant] = result.snapshot.userID
        }
        currentUserIDs = refreshed
    }

    @discardableResult
    func captureCurrent(_ variant: TraeVariant) throws -> TraeAccountProfile {
        try requireNoActiveSwitch()
        let result = try readCurrent(variant)
        try vault.save(result.snapshot)
        let profile = upsertProfile(
            snapshot: result.snapshot,
            payload: result.payload,
            lastUsedAt: Date()
        )
        currentUserIDs[variant] = profile.userID
        try saveIndex()
        return profile
    }

    func rename(_ profile: TraeAccountProfile, to nickname: String) throws {
        try requireNoActiveSwitch()
        let trimmed = nickname.trimmingCharacters(in: .whitespacesAndNewlines)
        guard
            !trimmed.isEmpty,
            let index = accounts.firstIndex(where: { $0.id == profile.id })
        else {
            return
        }
        accounts[index].nickname = trimmed
        try saveIndex()
    }

    func remove(_ profile: TraeAccountProfile) throws {
        try requireNoActiveSwitch()
        try vault.delete(variant: profile.variant, userID: profile.userID)
        accounts.removeAll { $0.id == profile.id }
        try saveIndex()
    }

    func switchAccount(to profile: TraeAccountProfile) async throws {
        try requireNoActiveSwitch()
        switchingVariant = profile.variant
        defer { switchingVariant = nil }

        let variant = profile.variant
        guard controller.applicationURL(for: variant) != nil else {
            throw TraeSupportError.applicationNotInstalled(variant)
        }
        let targetSnapshot = try vault.load(
            variant: variant,
            userID: profile.userID
        )
        guard targetSnapshot.variant == variant else {
            throw TraeSupportError.snapshotVariantMismatch
        }
        let targetPayload = try TraeStorageCodec.authPayload(
            from: targetSnapshot.authBlob
        )
        guard targetPayload.userID == profile.userID else {
            throw TraeSupportError.snapshotIdentityMismatch
        }

        let destination = storageURL(variant)
        guard FileManager.default.fileExists(atPath: destination.path) else {
            throw TraeSupportError.storageMissing(variant)
        }
        if let current = try? TraeStorageCodec.readSnapshot(
            from: Data(contentsOf: destination),
            variant: variant
        ), current.snapshot.userID == profile.userID {
            try vault.save(current.snapshot)
            _ = upsertProfile(
                snapshot: current.snapshot,
                payload: current.payload,
                lastUsedAt: Date()
            )
            currentUserIDs[variant] = current.snapshot.userID
            try saveIndex()
            try await controller.launch(variant)
            return
        }

        let wasRunning = controller.isRunning(variant)
        var previousData: Data?
        var previousAttributes: [FileAttributeKey: Any]?
        var rollbackAccounts = accounts
        var rollbackCurrentUserIDs = currentUserIDs
        var writeCompleted = false
        do {
            try await controller.stop(variant)

            // Trae can flush storage.json while quitting. Always snapshot and
            // patch the post-exit file so those final editor settings survive.
            let stoppedData = try Data(contentsOf: destination)
            previousData = stoppedData
            previousAttributes = try? FileManager.default.attributesOfItem(
                atPath: destination.path
            )

            if let current = try? TraeStorageCodec.readSnapshot(
                from: stoppedData,
                variant: variant
            ) {
                try vault.save(current.snapshot)
                _ = upsertProfile(
                    snapshot: current.snapshot,
                    payload: current.payload,
                    lastUsedAt: Date()
                )
                currentUserIDs[variant] = current.snapshot.userID
                try saveIndex()
            } else {
                currentUserIDs.removeValue(forKey: variant)
            }
            rollbackAccounts = accounts
            rollbackCurrentUserIDs = currentUserIDs

            if currentUserIDs[variant] == profile.userID {
                try await controller.launch(variant)
                return
            }

            let replacement = try TraeStorageCodec.replacingAuthentication(
                in: stoppedData,
                with: targetSnapshot,
                variant: variant
            )
            try TraeAtomicFile.write(
                replacement,
                to: destination,
                preserving: previousAttributes
            )
            writeCompleted = true

            let verificationData = try Data(contentsOf: destination)
            let verification = try TraeStorageCodec.readSnapshot(
                from: verificationData,
                variant: variant
            )
            guard verification.snapshot.userID == profile.userID else {
                throw TraeSupportError.snapshotIdentityMismatch
            }

            guard let index = accounts.firstIndex(where: { $0.id == profile.id }) else {
                throw TraeSupportError.accountSnapshotMissing
            }
            accounts[index].lastUsedAt = Date()
            accounts.sort { $0.lastUsedAt > $1.lastUsedAt }
            currentUserIDs[variant] = profile.userID
            try saveIndex()
            try await controller.launch(variant)
        } catch {
            let originalError = error
            var rollbackFailures: [String] = []
            if writeCompleted, let previousData {
                do {
                    try await controller.stop(variant)
                } catch {
                    rollbackFailures.append(
                        "无法停止目标实例：\(error.localizedDescription)"
                    )
                }
                do {
                    try TraeAtomicFile.write(
                        previousData,
                        to: destination,
                        preserving: previousAttributes
                    )
                } catch {
                    rollbackFailures.append("无法恢复旧凭据：\(error.localizedDescription)")
                }
            }
            accounts = rollbackAccounts
            currentUserIDs = rollbackCurrentUserIDs
            do {
                try saveIndex()
            } catch {
                rollbackFailures.append("无法恢复账号索引：\(error.localizedDescription)")
            }
            if wasRunning {
                do {
                    try await controller.launch(variant)
                } catch {
                    rollbackFailures.append(
                        "无法重新启动原账号：\(error.localizedDescription)"
                    )
                }
            }
            guard !rollbackFailures.isEmpty else {
                throw originalError
            }
            throw TraeSupportError.requestFailed(
                """
                Trae 账号切换失败：\(originalError.localizedDescription)
                回滚未完全成功：\(rollbackFailures.joined(separator: "；"))
                """
            )
        }
    }

    func hasSnapshot(for profile: TraeAccountProfile) -> Bool {
        (try? vault.load(
            variant: profile.variant,
            userID: profile.userID
        )) != nil
    }

    func snapshot(
        for variant: TraeVariant,
        userID: String
    ) throws -> TraeCredentialSnapshot {
        try vault.load(variant: variant, userID: userID)
    }

    private func readCurrent(
        _ variant: TraeVariant
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

    @discardableResult
    private func upsertProfile(
        snapshot: TraeCredentialSnapshot,
        payload: TraeAuthPayload,
        lastUsedAt: Date
    ) -> TraeAccountProfile {
        let existing = accounts.first {
            $0.variant == snapshot.variant && $0.userID == snapshot.userID
        }
        let fallbackName = payload.email
            ?? "\(snapshot.variant.displayName) \(snapshot.userID.prefix(6))"
        var profile = existing ?? TraeAccountProfile(
            variant: snapshot.variant,
            userID: snapshot.userID,
            nickname: payload.displayName ?? fallbackName,
            email: payload.email,
            avatarURL: payload.avatarURL,
            capturedAt: snapshot.capturedAt,
            lastUsedAt: lastUsedAt
        )
        if existing == nil, let displayName = payload.displayName {
            profile.nickname = displayName
        }
        profile.email = payload.email ?? profile.email
        profile.avatarURL = payload.avatarURL ?? profile.avatarURL
        profile.capturedAt = snapshot.capturedAt
        profile.lastUsedAt = lastUsedAt
        accounts.removeAll { $0.id == profile.id }
        accounts.append(profile)
        accounts.sort { $0.lastUsedAt > $1.lastUsedAt }
        return profile
    }

    private func loadIndex() {
        guard let data = try? Data(contentsOf: indexURL) else { return }
        guard
            let index = try? decoder.decode(PersistedIndex.self, from: data),
            index.version == 1
        else {
            return
        }
        accounts = index.accounts
    }

    private func saveIndex() throws {
        let data = try encoder.encode(PersistedIndex(version: 1, accounts: accounts))
        let attributes = try? FileManager.default.attributesOfItem(atPath: indexURL.path)
        try TraeAtomicFile.write(data, to: indexURL, preserving: attributes)
    }

    private func requireNoActiveSwitch() throws {
        guard switchingVariant == nil else {
            throw TraeSupportError.switchInProgress
        }
    }
}

private extension Data {
    init?(hex: String) {
        let normalized = hex.filter { !$0.isWhitespace }
        guard normalized.count.isMultiple(of: 2) else { return nil }
        var bytes = [UInt8]()
        bytes.reserveCapacity(normalized.count / 2)
        var index = normalized.startIndex
        while index < normalized.endIndex {
            let next = normalized.index(index, offsetBy: 2)
            guard let byte = UInt8(normalized[index..<next], radix: 16) else {
                return nil
            }
            bytes.append(byte)
            index = next
        }
        self.init(bytes)
    }
}
