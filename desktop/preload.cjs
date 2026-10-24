const { contextBridge, ipcRenderer } = require("electron");
const call =
  (name) =>
  async (...args) => {
    const result = await ipcRenderer.invoke(`wb:${name}`, ...args);
    if (!result.ok) throw new Error(result.error);
    return result.value;
  };
contextBridge.exposeInMainWorld("workbuddy", {
  snapshot: call("snapshot"),
  workbuddyScope: call("workbuddy-scope"),
  refreshEditor: call("editor-refresh"),
  captureEditor: call("editor-capture"),
  switchEditor: call("editor-switch"),
  editEditor: call("editor-edit"),
  removeEditor: call("editor-remove"),
  restoreEditor: call("editor-restore"),
  keepCurrentEditor: call("editor-keep-current"),
  launchEditor: call("editor-launch"),
  traySwitchEditor: call("editor-tray-switch"),
  chooseEditorPath: call("editor-choose-path"),
  capture: call("capture"),
  switchAccount: call("switch"),
  editAccount: call("edit"),
  removeAccount: call("remove"),
  refreshQuotas: call("refresh"),
  refreshRewards: call("rewards-refresh"),
  claimRewards: call("rewards-claim"),
  runTasks: call("tasks-run"),
  prepareTasks: call("tasks-prepare"),
  cancelTasks: call("tasks-cancel"),
  departTravel: call("travel-depart"),
  openPage: call("open-page"),
  traySwitch: call("tray-switch"),
  quit: call("quit"),
  sessions: call("sessions"),
  usage: call("usage"),
  resume: call("resume"),
  saveSettings: call("settings"),
  choosePath: call("choose-path"),
  diagnostics: call("diagnostics"),
  backups: call("backups"),
  backupSessions: call("backup-sessions"),
  openFolder: call("open-folder"),
  exportAccounts: call("export"),
  importAccounts: call("import"),
  importLegacy: call("legacy"),
  exportUsage: call("export-usage"),
  checkUpdate: call("update"),
  openLink: call("link"),
  launchClient: call("launch"),
  startLogin: call("login-start"),
  pollLogin: call("login-poll"),
  openLogin: call("login-open"),
  cancelLogin: call("login-cancel"),
  onChange(callback) {
    const listener = () => callback();
    ipcRenderer.on("wb:changed", listener);
    return () => ipcRenderer.removeListener("wb:changed", listener);
  },
  onNavigate(callback) {
    const listener = (_event, page) => callback(page);
    ipcRenderer.on("wb:navigate", listener);
    return () => ipcRenderer.removeListener("wb:navigate", listener);
  },
});
