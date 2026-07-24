import SwiftUI

@main
struct OpenUsageApp: App {
    @StateObject private var state = AppState()

    var body: some Scene {
        Window("WorkBuddy Switch", id: "main") {
            RootView(state: state)
                .frame(minWidth: 1120, minHeight: 620)
                .task { await state.start() }
        }
        .defaultSize(width: 1120, height: 740)
        .commands {
            CommandGroup(after: .sidebar) {
                Divider()
                Button("刷新用量") {
                    Task { await state.refreshAll(force: true) }
                }
                .keyboardShortcut("r", modifiers: .command)

                Button("捕获当前 WorkBuddy 账号") {
                    state.captureCurrentAccount()
                }
                .keyboardShortcut("s", modifiers: [.command, .shift])
            }
        }

        MenuBarExtra {
            MenuBarView(state: state)
        } label: {
            Label("WorkBuddy Switch", systemImage: "chart.bar.fill")
        }
        .menuBarExtraStyle(.window)

        Settings {
            SettingsView(state: state)
                .frame(width: 600, height: 500)
        }
    }
}
