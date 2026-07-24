import AppKit
import Foundation

struct WorkBuddyController {
    static let bundleIdentifier = "com.workbuddy.workbuddy"
    private static let gracefulTerminationTimeout: TimeInterval = 5
    private static let forcedTerminationTimeout: TimeInterval = 3
    private static let terminationPollInterval: UInt64 = 150_000_000

    var applicationURL: URL? {
        NSWorkspace.shared.urlForApplication(withBundleIdentifier: Self.bundleIdentifier)
    }

    var cliURL: URL? {
        guard let applicationURL else { return nil }
        let path = applicationURL
            .appendingPathComponent("Contents/Resources/app.asar.unpacked/cli/bin/codebuddy")
        return FileManager.default.isExecutableFile(atPath: path.path) ? path : nil
    }

    @MainActor
    func stop() async throws {
        let running = runningApplications()
        guard !running.isEmpty else { return }

        running.filter { !$0.isTerminated }.forEach { _ = $0.terminate() }
        if try await waitUntilStopped(
            deadline: Date().addingTimeInterval(Self.gracefulTerminationTimeout)
        ) {
            return
        }

        runningApplications()
            .filter { !$0.isTerminated }
            .forEach { _ = $0.forceTerminate() }
        if try await waitUntilStopped(
            deadline: Date().addingTimeInterval(Self.forcedTerminationTimeout)
        ) {
            return
        }

        let remaining = runningApplications().count
        throw OpenUsageError.commandFailed(
            "WorkBuddy 仍有 \(remaining) 个实例未退出，无法安全更改登录凭据。"
        )
    }

    @MainActor
    func launch() async throws {
        guard let applicationURL else { throw OpenUsageError.workBuddyNotInstalled }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        _ = try await NSWorkspace.shared.openApplication(
            at: applicationURL,
            configuration: configuration
        )
    }

    @MainActor
    func openSession(_ sessionID: String) async throws {
        var components = URLComponents()
        components.scheme = "workbuddy"
        components.host = "chat"
        components.path = "/\(sessionID)"
        guard let url = components.url else {
            throw OpenUsageError.commandFailed("无法构造 WorkBuddy 对话链接。")
        }
        let opened = NSWorkspace.shared.open(url)
        guard opened else {
            throw OpenUsageError.commandFailed("WorkBuddy 无法打开该对话。")
        }
    }

    @MainActor
    func openSessionInTerminal(_ session: SessionRecord) throws {
        guard let cliURL else {
            throw OpenUsageError.commandFailed("当前 WorkBuddy 版本没有附带命令行工具。")
        }
        let script = [
            "cd \(shellQuote(session.workingDirectory))",
            "\(shellQuote(cliURL.path)) --resume \(shellQuote(session.id))"
        ].joined(separator: " && ")
        let escaped = script
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        let appleScript = """
        tell application "Terminal"
            activate
            do script "\(escaped)"
        end tell
        """
        var error: NSDictionary?
        NSAppleScript(source: appleScript)?.executeAndReturnError(&error)
        if let error {
            throw OpenUsageError.commandFailed(
                error[NSAppleScript.errorMessage] as? String ?? "无法打开终端。"
            )
        }
    }

    static func sessionDeepLink(_ sessionID: String) -> URL? {
        var components = URLComponents()
        components.scheme = "workbuddy"
        components.host = "chat"
        components.path = "/\(sessionID)"
        return components.url
    }

    @MainActor
    private func runningApplications() -> [NSRunningApplication] {
        NSRunningApplication.runningApplications(
            withBundleIdentifier: Self.bundleIdentifier
        )
    }

    @MainActor
    private func waitUntilStopped(deadline: Date) async throws -> Bool {
        while true {
            if runningApplications().isEmpty { return true }
            guard Date() < deadline else { return false }
            try Task.checkCancellation()
            try await Task.sleep(nanoseconds: Self.terminationPollInterval)
        }
    }

    private func shellQuote(_ value: String) -> String {
        "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }
}
