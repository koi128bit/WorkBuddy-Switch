import test from "node:test";
import assert from "node:assert/strict";
import { editorDataPath } from "../desktop/editor-controller.mjs";
import { resolvePaths } from "../desktop/settings.mjs";

test("Linux editor data follows XDG rather than macOS directories", () => {
  const context = { platform: "linux", home: "/home/tester", env: { XDG_CONFIG_HOME: "/isolated/config" } };
  assert.equal(editorDataPath("trae-cn", {}, context), "/isolated/config/Trae CN");
  assert.equal(editorDataPath("qoder-cn", {}, context), "/isolated/config/com.qodercn.app.stable");
});
test("Linux WorkBuddy login follows XDG data and supports a separate international scope", () => {
  const context = { platform: "linux", home: "/home/tester", env: { XDG_DATA_HOME: "/isolated/data" } };
  assert.equal(resolvePaths({}, context).auth, "/isolated/data/CodeBuddyExtension/Data/Public/auth/workbuddy-desktop.info");
  assert.equal(resolvePaths({}, { ...context, provider: "workbuddy-global" }).auth, "/isolated/data/CodeBuddyExtension/Data/Public/auth/workbuddy-desktop-ai.info");
});
test("scope registry separates product, region and host capabilities", async () => {
  const registry = await import("../desktop/client-registry.mjs").catch(() => ({}));
  assert.equal(typeof registry.clientDefinition, "function", "a shared registry is required");
  const cn = registry.clientDefinition("qoder-cn");
  const global = registry.clientDefinition("qoder-global");
  assert.equal(cn.product, "qoder");
  assert.equal(cn.region, "cn");
  assert.equal(global.region, "global");
  assert.notEqual(cn.data, global.data);
  assert.throws(() => registry.clientDefinition("qoder/../../workbuddy"));
  assert.throws(() => registry.clientDefinition("unknown"));
});
test("Linux credential vault rejects the basic_text fallback", async () => {
  const vaultModule = await import("../desktop/platform.mjs").catch(() => ({}));
  assert.equal(typeof vaultModule.createSystemVault, "function", "system vault must check backend strength");
  const engine = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => "basic_text", encryptString: () => Buffer.from("unsafe"), decryptString: () => "unsafe" };
  const vault = vaultModule.createSystemVault(engine, "linux");
  assert.equal(vault.available(), false);
  assert.throws(() => vault.encrypt("credential"));
  engine.getSelectedStorageBackend = () => "gnome_libsecret";
  assert.equal(vault.available(), true);
});
