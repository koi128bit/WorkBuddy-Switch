import Foundation

struct AuthDocument {
    let rawData: Data
    let userID: String
    let nickname: String
    let accountType: String?
    let phoneHint: String?

    init(data: Data) throws {
        guard
            let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let account = root["account"] as? [String: Any],
            let uid = Self.string(account["uid"]), !uid.isEmpty,
            let auth = root["auth"] as? [String: Any],
            let accessToken = Self.string(auth["accessToken"]), !accessToken.isEmpty
        else {
            throw OpenUsageError.invalidAuthenticationFile
        }

        rawData = data
        userID = uid
        nickname = Self.string(account["nickname"]) ?? "WorkBuddy 账号"
        accountType = Self.string(account["accountType"]) ?? Self.string(account["type"])
        phoneHint = Self.maskedPhone(Self.string(account["phoneNumber"]))
    }

    static func loadActive() throws -> AuthDocument {
        guard FileManager.default.fileExists(atPath: AppPaths.authFile.path) else {
            throw OpenUsageError.authenticationFileMissing
        }
        return try AuthDocument(data: Data(contentsOf: AppPaths.authFile))
    }

    private static func string(_ value: Any?) -> String? {
        if let value = value as? String { return value }
        if let value = value as? NSNumber { return value.stringValue }
        return nil
    }

    private static func maskedPhone(_ value: String?) -> String? {
        guard let value, value.count >= 7 else { return nil }
        return "\(value.prefix(3))****\(value.suffix(4))"
    }

    func accessToken() throws -> String {
        guard
            let root = try JSONSerialization.jsonObject(with: rawData) as? [String: Any],
            let auth = root["auth"] as? [String: Any],
            let token = auth["accessToken"] as? String,
            !token.isEmpty
        else {
            throw OpenUsageError.invalidAuthenticationFile
        }
        return token
    }
}
