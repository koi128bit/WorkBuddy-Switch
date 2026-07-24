import Foundation

enum AppPaths {
    static let home = FileManager.default.homeDirectoryForCurrentUser

    static let workBuddyRoot = home.appendingPathComponent(".workbuddy", isDirectory: true)
    static let workBuddyDatabase = workBuddyRoot.appendingPathComponent("workbuddy.db")
    static let workBuddyProjects = workBuddyRoot.appendingPathComponent("projects", isDirectory: true)

    static let authFile = home
        .appendingPathComponent("Library/Application Support/CodeBuddyExtension/Data/Public/auth", isDirectory: true)
        .appendingPathComponent("workbuddy-desktop.info")

    static let appSupport = home
        .appendingPathComponent("Library/Application Support/OpenUsage", isDirectory: true)
    static let accountIndex = appSupport.appendingPathComponent("accounts.json")

    static func prepareAppSupport() throws {
        try FileManager.default.createDirectory(
            at: appSupport,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
    }
}
