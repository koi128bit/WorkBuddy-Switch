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
  capture: call("capture"),
  switchAccount: call("switch"),
  editAccount: call("edit"),
  removeAccount: call("remove"),
  refreshQuotas: call("refresh"),
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
});
