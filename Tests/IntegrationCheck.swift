import Foundation

@main
enum OpenUsageIntegrationCheck {
    static func main() async throws {
        let authStatus: String
        do {
            _ = try AuthDocument.loadActive()
            authStatus = "valid"
        } catch OpenUsageError.authenticationFileMissing {
            authStatus = "not-present"
        } catch {
            authStatus = "invalid"
        }

        let sessions: [SessionRecord]
        do {
            sessions = try SessionStore().loadSessions(includeDeleted: true)
        } catch OpenUsageError.databaseUnavailable {
            sessions = []
        }

        let usage = try await UsageService().scan(
            period: .all,
            accountID: nil,
            force: true
        )

        guard WorkBuddyController.sessionDeepLink("fixture")?.absoluteString
            == "workbuddy://chat/fixture" else {
            throw IntegrationFailure("WorkBuddy deep-link construction failed")
        }
        guard
            ManagedProvider.traeCN.traeVariant == .china,
            ManagedProvider.traeWork.traeVariant == .work,
            try TraeOfficialHostPolicy.baseURL(
                rawHost: nil,
                variant: .china
            ).host == "api.trae.cn"
        else {
            throw IntegrationFailure("Trae provider mapping failed")
        }

        print("auth_document=\(authStatus)")
        print("session_database_readable=\(!sessions.isEmpty)")
        print("session_rows=\(sessions.count)")
        print("usage_files=\(usage.scannedFiles)")
        print("usage_records_readable=\(usage.total.total > 0)")
        print("session_usage_joined=\(!usage.sessions.isEmpty)")
        print("trae_provider_mapping=valid")
        print("integration_check=passed")
    }
}

private struct IntegrationFailure: LocalizedError {
    let reason: String

    init(_ reason: String) {
        self.reason = reason
    }

    var errorDescription: String? { reason }
}
