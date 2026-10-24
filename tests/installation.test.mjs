import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
let api;
try {
  api = await import("../desktop/installation.mjs");
} catch {}
const exe = (base) => `${base}/Contents/MacOS/WorkBuddy Switch`;
function fixture({
  response = 0,
  installed = { id: "com.koi128bit.workbuddy-switch", version: "1.4.0" },
  peers = "ok",
  move = true,
} = {}) {
  const calls = [];
  const app = {
    isPackaged: true,
    getVersion: () => "1.5.0",
    getPath: () => "/fixture/user-data",
    moveToApplicationsFolder(options) {
      calls.push("move");
      assert.equal(options.conflictHandler("exists"), true);
      assert.equal(options.conflictHandler("existsAndRunning"), false);
      return move;
    },
  };
  const dialog = {
    async showMessageBox(options) {
      calls.push(options.message);
      return { response };
    },
  };
  return {
    calls,
    args: {
      app,
      dialog,
      shell: {
        async openPath(file) {
          calls.push(file);
          return "";
        },
      },
      readInstalled: async () => installed,
      quitPeers: async () => {
        calls.push("quit-peers");
        return peers;
      },
    },
  };
}
test("packaged macOS copies outside the canonical install need installation while developer and installed launches do not", () => {
  assert.equal(typeof api?.needsMacInstallation, "function");
  assert.equal(
    api.needsMacInstallation({
      platform: "darwin",
      packaged: true,
      executable: exe("/Volumes/WorkBuddy Switch 1.5.0/WorkBuddy Switch.app"),
    }),
    true,
  );
  assert.equal(
    api.needsMacInstallation({
      platform: "darwin",
      packaged: true,
      executable: exe("/Applications/WorkBuddy Switch.app"),
    }),
    false,
  );
  assert.equal(
    api.needsMacInstallation({
      platform: "darwin",
      packaged: false,
      executable: exe("/fixture/WorkBuddy Switch.app"),
    }),
    false,
  );
  assert.equal(
    api.needsMacInstallation({
      platform: "win32",
      packaged: true,
      executable: "C:\\fixture\\WorkBuddy Switch.exe",
    }),
    false,
  );
});
test("installation confirmation precedes stopping peers and replaces the existing app only after peers exit", async () => {
  assert.equal(typeof api?.offerMacInstallation, "function");
  const f = fixture();
  assert.equal(await api.offerMacInstallation(f.args), "exit");
  assert.match(f.calls[0], /安装/);
  assert.equal(f.calls[1], "quit-peers");
  assert.equal(f.calls[2], "move");
});
test("cancelled installation and an active task never move or overwrite the app", async () => {
  assert.equal(typeof api?.offerMacInstallation, "function");
  const cancelled = fixture({ response: 1 });
  await api.offerMacInstallation(cancelled.args);
  assert.ok(!cancelled.calls.includes("quit-peers"));
  assert.ok(!cancelled.calls.includes("move"));
  const busy = fixture({ peers: "busy" });
  await api.offerMacInstallation(busy.args);
  assert.ok(!busy.calls.includes("move"));
  assert.ok(busy.calls.some((text) => /任务/.test(text)));
});
test("an older disk image opens the newer installed version instead of downgrading it", async () => {
  assert.equal(typeof api?.offerMacInstallation, "function");
  const f = fixture({
    installed: { id: "com.koi128bit.workbuddy-switch", version: "1.6.0" },
  });
  await api.offerMacInstallation(f.args);
  assert.ok(f.calls.includes("/Applications/WorkBuddy Switch.app"));
  assert.ok(!f.calls.includes("move"));
  assert.ok(!f.calls.includes("quit-peers"));
});
test("a conflicting app identifier, running peer or failed move cannot silently start a temporary duplicate", async () => {
  assert.equal(typeof api?.offerMacInstallation, "function");
  for (const options of [
    { installed: { id: "another.app", version: "1.0.0" } },
    { peers: "running" },
    { move: false },
  ]) {
    const f = fixture(options);
    assert.equal(await api.offerMacInstallation(f.args), "exit");
    assert.ok(f.calls.length > 0);
  }
});
test("upgrade shutdown waits for an in-flight operation and resumes once after it becomes idle", async () => {
  assert.equal(typeof api?.QuitGate, "function");
  let busy = true,
    waits = 0,
    quits = 0,
    prevented = 0;
  const gate = new api.QuitGate({
    isBusy: () => busy,
    onWait: () => waits++,
    onQuit: () => quits++,
  });
  const event = {
    preventDefault() {
      prevented++;
    },
  };
  assert.equal(gate.request(event), false);
  assert.equal(gate.request(event), false);
  assert.equal(waits, 1);
  assert.equal(prevented, 2);
  assert.equal(gate.pending, true);
  gate.changed();
  assert.equal(quits, 0);
  busy = false;
  gate.changed();
  gate.changed();
  await Promise.resolve();
  assert.equal(quits, 1);
  assert.equal(gate.request(event), true);
});
test("all installer identities are stable and macOS packages replace a fixed application location", async () => {
  const pkg = JSON.parse(
    await fs.readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(pkg.build.appId, "com.koi128bit.workbuddy-switch");
  assert.equal(pkg.build.productName, "WorkBuddy Switch");
  assert.equal(pkg.build.nsis.guid, "cff115b9-d86e-58de-afc6-4752a9c78ba4");
  assert.equal(pkg.build.nsis.allowToChangeInstallationDirectory, false);
  assert.equal(pkg.build.nsis.deleteAppDataOnUninstall, false);
  assert.equal(pkg.build.pkg.installLocation, "/Applications");
  assert.equal(pkg.build.pkg.isRelocatable, false);
  assert.equal(pkg.build.pkg.overwriteAction, "upgrade");
  assert.deepEqual(pkg.build.pkg.mustClose, ["com.koi128bit.workbuddy-switch"]);
  assert.ok(pkg.scripts["dist:mac"].includes("pkg"));
});
