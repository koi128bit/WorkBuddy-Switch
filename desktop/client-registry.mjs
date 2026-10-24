const capabilities = { capture: true, switch: true, browserLogin: true, refresh: true, quota: true };
const definition = (id, product, region, name, values) => { const { capabilities: extra, ...fields } = values; return Object.freeze({ id, product, region, program: "desktop", name, platforms: ["darwin", "win32", "linux"], ...fields, capabilities: Object.freeze({ ...capabilities, rewards: false, sessions: product === "workbuddy", usage: product === "workbuddy", ...extra }) }); };

export const clients = Object.freeze({
  workbuddy: definition("workbuddy", "workbuddy", "cn", "WorkBuddy", { key: "workbuddy", app: "WorkBuddy.app", executable: "WorkBuddy.exe", bundle: "com.workbuddy.workbuddy", data: ".workbuddy", authFile: "workbuddy-desktop.info", linuxNames: ["workbuddy"], linuxExecutables: ["/usr/bin/workbuddy", "/opt/workbuddy/workbuddy", "/usr/share/workbuddy/workbuddy"], origin: "https://www.codebuddy.cn", oauthPlatform: "workbuddy", capabilities: { rewards: true } }),
  "workbuddy-global": definition("workbuddy-global", "workbuddy", "global", "WorkBuddy 国际版", { key: "workbuddyGlobal", app: "WorkBuddy AI.app", executable: "WorkBuddyAI.exe", bundle: "com.workbuddy.workbuddy-ai", data: ".workbuddy-ai", authFile: "workbuddy-desktop-ai.info", linuxNames: ["workbuddy-ai"], linuxExecutables: ["/usr/bin/workbuddy-ai", "/opt/workbuddy-ai/workbuddy-ai", "/usr/share/workbuddy-ai/workbuddy-ai"], origin: "https://www.workbuddy.ai", oauthPlatform: "workbuddy-ai" }),
  "trae-cn": definition("trae-cn", "trae", "cn", "Trae CN", { key: "trae", app: "Trae CN.app", executable: "Trae CN.exe", bundle: "cn.trae.app", data: "Trae CN", windows: ["Trae CN", "Trae"], linuxNames: ["trae-cn"], linuxExecutables: ["/opt/trae-cn/trae-cn", "/usr/share/trae-cn/trae-cn", "/usr/bin/trae-cn", "/usr/local/bin/trae-cn"], origin: "https://www.trae.cn", accountOrigin: "https://api.trae.cn", authClientId: "ono9krqynydwx5", authKind: "trae" }),
  "trae-global": definition("trae-global", "trae", "global", "Trae 国际版", { key: "traeGlobal", app: "Trae.app", executable: "Trae.exe", bundle: "com.trae.app", data: "Trae", windows: ["Trae"], linuxNames: ["trae"], linuxExecutables: ["/opt/trae/trae", "/usr/share/trae/trae", "/usr/bin/trae", "/usr/local/bin/trae"], origin: "https://www.trae.ai", accountOrigin: "https://grow-normal.trae.ai", authClientId: "ono9krqynydwx5", authKind: "trae" }),
  "qoder-cn": definition("qoder-cn", "qoder", "cn", "Qoder CN", { key: "qoder", app: "Qoder CN.app", executable: "Qoder CN.exe", bundle: "com.qodercn.app", data: "com.qodercn.app.stable", cliHome: ".qoder-cn", windows: ["Qoder CN", "QoderCN"], linuxNames: ["qoder-cn"], linuxExecutables: ["/usr/share/qoder-cn/qoder-cn", "/opt/Qoder CN/qoder-cn", "/usr/bin/qoder-cn"], origin: "https://qoder.com.cn", accountOrigin: "https://openapi.qoder.com.cn", authClientId: "1c5e33e1-364d-4ce6-b02c-acaa81274a5c", authRedirect: "qoder-work-cn://", keychainService: "Qoder CN App Safe Storage", linuxKeyApplication: "qoder-cn-app", authKind: "qoder" }),
  "qoder-global": definition("qoder-global", "qoder", "global", "Qoder 国际版", { key: "qoderGlobal", app: "Qoder.app", executable: "Qoder.exe", bundle: "com.qoder.app", data: "com.qoder.app.stable", cliHome: ".qoder", windows: ["Qoder"], linuxNames: ["qoder"], linuxExecutables: ["/usr/share/qoder/qoder", "/opt/Qoder/qoder", "/usr/bin/qoder"], origin: "https://qoder.com", accountOrigin: "https://openapi.qoder.sh", authClientId: "e883ade2-e6e3-4d6d-adf7-f92ceff5fdcb", authRedirect: "", keychainService: "Qoder Safe Storage", linuxKeyApplication: "qoder", authKind: "qoder" }),
});
export function clientDefinition(id) {
  if (typeof id !== "string" || !Object.hasOwn(clients, id)) throw new Error("不支持的客户端或地区。");
  return clients[id];
}
export function editorDefinition(id) {
  const result = clientDefinition(id);
  if (result.product === "workbuddy") throw new Error("请选择 Trae 或 Qoder 客户端。");
  return result;
}
export const editorDefinitions = Object.freeze(Object.fromEntries(Object.entries(clients).filter(([, item]) => item.product !== "workbuddy")));
export function isWorkBuddy(id) { return clientDefinition(id).product === "workbuddy"; }
