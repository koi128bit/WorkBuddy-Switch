import Darwin
import Foundation

@MainActor
final class AccountStore: ObservableObject {
    @Published private(set) var accounts: [AccountProfile] = []
    @Published private(set) var currentUserID: String?
    @Published private(set) var isSwitching = false

    private let vault = KeychainVault()
    private let workBuddy = WorkBuddyController()
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

    init() {
        loadIndex()
        refreshCurrentAccount()
    }

    var currentAccount: AccountProfile? {
        accounts.first { $0.id == currentUserID }
    }

    func refreshCurrentAccount() {
        guard !isSwitching else { return }
        currentUserID = try? AuthDocument.loadActive().userID
    }

    @discardableResult
    func captureCurrent() throws -> AccountProfile {
        try requireNoActiveSwitch()
        return try capture(try AuthDocument.loadActive())
    }

    func rename(_ profile: AccountProfile, to nickname: String) throws {
        try requireNoActiveSwitch()
        guard let index = accounts.firstIndex(where: { $0.id == profile.id }) else { return }
        let trimmed = nickname.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        accounts[index].nickname = trimmed
        try saveIndex()
    }

    func remove(_ profile: AccountProfile) throws {
        try requireNoActiveSwitch()
        try vault.delete(account: profile.id)
        accounts.removeAll { $0.id == profile.id }
        try saveIndex()
    }

    func switchAccount(to profile: AccountProfile) async throws {
        try requireNoActiveSwitch()
        isSwitching = true
        defer { isSwitching = false }

        guard workBuddy.applicationURL != nil else {
            throw OpenUsageError.workBuddyNotInstalled
        }

        let fileManager = FileManager.default
        currentUserID = nil
        let authenticationExisted = fileManager.fileExists(atPath: AppPaths.authFile.path)
        let previousData = authenticationExisted
            ? try Data(contentsOf: AppPaths.authFile)
            : nil
        let sourceDocument = try previousData.map(AuthDocument.init(data:))
        currentUserID = sourceDocument?.userID

        guard sourceDocument?.userID != profile.id else {
            try await workBuddy.launch()
            return
        }

        let targetData = try vault.load(account: profile.id)
        let targetDocument = try AuthDocument(data: targetData)
        guard targetDocument.userID == profile.id else {
            throw OpenUsageError.commandFailed(
                "钥匙串快照身份与所选账号不匹配，请重新登录并保存该账号。"
            )
        }

        try AppPaths.prepareAppSupport()
        let rollbackAccounts = accounts
        let rollbackUserID = sourceDocument?.userID
        if let sourceDocument {
            _ = try capture(sourceDocument)
        }

        var authenticationWriteAttempted = false
        do {
            try await workBuddy.stop()
            authenticationWriteAttempted = true
            try writeAuthenticationAtomically(targetData)
            guard let index = accounts.firstIndex(where: { $0.id == profile.id }) else {
                throw OpenUsageError.accountSnapshotMissing
            }
            accounts[index].lastUsedAt = Date()
            accounts.sort { $0.lastUsedAt > $1.lastUsedAt }
            currentUserID = profile.id
            try saveIndex()
            try await workBuddy.launch()
        } catch {
            let originalError = error
            let rollbackFailures = await Task { @MainActor [self] in
                await rollbackSwitch(
                    previousData: previousData,
                    previousAccounts: rollbackAccounts,
                    previousUserID: rollbackUserID,
                    authenticationWriteAttempted: authenticationWriteAttempted
                )
            }.value
            if rollbackFailures.isEmpty {
                throw originalError
            }
            throw OpenUsageError.commandFailed(
                """
                账号切换失败：\(originalError.localizedDescription)
                回滚未完全成功：\(rollbackFailures.joined(separator: "；"))
                """
            )
        }
    }

    func hasSnapshot(for userID: String) -> Bool {
        (try? vault.load(account: userID)) != nil
    }

    private func loadIndex() {
        guard let data = try? Data(contentsOf: AppPaths.accountIndex) else { return }
        accounts = (try? decoder.decode([AccountProfile].self, from: data)) ?? []
    }

    private func requireNoActiveSwitch() throws {
        guard !isSwitching else {
            throw OpenUsageError.commandFailed("已有账号切换正在进行，请稍候。")
        }
    }

    @discardableResult
    private func capture(_ document: AuthDocument) throws -> AccountProfile {
        let previousAccounts = accounts
        let previousUserID = currentUserID
        do {
            try vault.save(document.rawData, account: document.userID)
            let now = Date()
            var profile = accounts.first { $0.id == document.userID } ?? AccountProfile(
                id: document.userID,
                nickname: document.nickname,
                accountType: document.accountType,
                phoneHint: document.phoneHint,
                capturedAt: now,
                lastUsedAt: now
            )
            profile.accountType = document.accountType
            profile.phoneHint = document.phoneHint
            profile.lastUsedAt = now

            accounts.removeAll { $0.id == profile.id }
            accounts.append(profile)
            accounts.sort { $0.lastUsedAt > $1.lastUsedAt }
            currentUserID = profile.id
            try saveIndex()
            return profile
        } catch {
            accounts = previousAccounts
            currentUserID = previousUserID
            throw error
        }
    }

    private func rollbackSwitch(
        previousData: Data?,
        previousAccounts: [AccountProfile],
        previousUserID: String?,
        authenticationWriteAttempted: Bool
    ) async -> [String] {
        var failures: [String] = []

        let authenticationRestored: Bool
        if authenticationWriteAttempted {
            do {
                try await workBuddy.stop()
            } catch {
                failures.append("无法停止目标实例：\(error.localizedDescription)")
            }

            do {
                if let previousData {
                    try writeAuthenticationAtomically(previousData)
                } else {
                    try removeAuthenticationFile()
                }
                authenticationRestored = true
            } catch {
                authenticationRestored = false
                failures.append("无法恢复旧凭据：\(error.localizedDescription)")
            }
        } else {
            authenticationRestored = true
        }

        accounts = previousAccounts
        currentUserID = authenticationRestored
            ? previousUserID
            : (try? AuthDocument.loadActive().userID)
        do {
            try saveIndex()
        } catch {
            failures.append("无法恢复账号索引：\(error.localizedDescription)")
        }

        if authenticationRestored, previousData != nil {
            do {
                try await workBuddy.launch()
            } catch {
                failures.append("无法重新启动旧身份：\(error.localizedDescription)")
            }
        }
        return failures
    }

    private func removeAuthenticationFile() throws {
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(
            atPath: AppPaths.authFile.path,
            isDirectory: &isDirectory
        ) else {
            return
        }
        guard !isDirectory.boolValue else {
            throw OpenUsageError.commandFailed("WorkBuddy 登录凭据路径意外变成了目录。")
        }
        try FileManager.default.removeItem(at: AppPaths.authFile)
    }

    private func saveIndex() throws {
        try AppPaths.prepareAppSupport()
        let data = try encoder.encode(accounts)
        try data.write(to: AppPaths.accountIndex, options: [.atomic])
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o600],
            ofItemAtPath: AppPaths.accountIndex.path
        )
    }

    private func writeAuthenticationAtomically(_ data: Data) throws {
        let directory = AppPaths.authFile.deletingLastPathComponent()
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        let temporary = directory.appendingPathComponent(".openusage-\(UUID().uuidString).tmp")
        do {
            try data.write(to: temporary, options: [.atomic])
            try secureAuthenticationFile(at: temporary)
            if FileManager.default.fileExists(atPath: AppPaths.authFile.path) {
                _ = try FileManager.default.replaceItemAt(
                    AppPaths.authFile,
                    withItemAt: temporary,
                    backupItemName: nil,
                    options: [.usingNewMetadataOnly]
                )
            } else {
                try FileManager.default.moveItem(at: temporary, to: AppPaths.authFile)
            }
            try secureAuthenticationFile(at: AppPaths.authFile)
        } catch {
            try? FileManager.default.removeItem(at: temporary)
            throw error
        }
    }

    private func secureAuthenticationFile(at url: URL) throws {
        try removeExtendedACL(at: url)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o600],
            ofItemAtPath: url.path
        )
    }

    private func removeExtendedACL(at url: URL) throws {
        guard let acl = acl_init(0) else {
            throw NSError(domain: NSPOSIXErrorDomain, code: Int(ENOMEM))
        }
        defer { acl_free(UnsafeMutableRawPointer(acl)) }

        let result = url.withUnsafeFileSystemRepresentation { path -> Int32 in
            guard let path else {
                errno = EINVAL
                return -1
            }
            return acl_set_file(path, ACL_TYPE_EXTENDED, acl)
        }
        guard result == 0 else {
            let errorCode = errno
            if errorCode == EOPNOTSUPP { return }
            throw NSError(domain: NSPOSIXErrorDomain, code: Int(errorCode))
        }
    }
}
