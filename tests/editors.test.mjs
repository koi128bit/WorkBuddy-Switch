import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { EditorStore } from "../desktop/editor-store.mjs";
import {
  readEditorAuth,
  hasEditorLogin,
  writeEditorAuth,
  authFingerprint,
} from "../desktop/editor-auth.mjs";
import {
  parseQoderLauncher,
  EditorController,
} from "../desktop/editor-controller.mjs";
import { defaults, validateSettings } from "../desktop/settings.mjs";

const authKey = "iCubeAuthInfo://icube.cloudide";
const serverKey = "iCubeServerData://icube.cloudide";
async function fixture(
  t,
  platform = process.platform === "win32" ? "win32" : "darwin",
) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "wb-editors-test-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const settings = {
    ...defaults,
    traeDataPath: path.join(directory, "Trae CN"),
    qoderDataPath: path.join(directory, "com.qodercn.app.stable"),
  };
  const key = randomBytes(32);
  const vault = {
    available: () => true,
    encrypt(raw) {
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", key, iv);
      return Buffer.concat([
        iv,
        cipher.update(raw),
        cipher.final(),
        cipher.getAuthTag(),
      ]);
    },
    decrypt(bytes) {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        bytes.subarray(0, 12),
      );
      decipher.setAuthTag(bytes.subarray(-16));
      return Buffer.concat([
        decipher.update(bytes.subarray(12, -16)),
        decipher.final(),
      ]).toString();
    },
  };
  const control = {
    running: false,
    failStop: false,
    failLaunch: 0,
    afterStop: null,
    status: async () => ({
      installed: true,
      running: control.running,
      executable: "fixture",
    }),
    async stop() {
      if (control.failStop) throw new Error("退出失败");
      control.running = false;
      if (control.afterStop) {
        const callback = control.afterStop;
        control.afterStop = null;
        await callback();
      }
    },
    async assertStopped() {
      if (control.running) throw new Error("仍在运行");
    },
    async launch() {
      if (control.failLaunch > 0) {
        control.failLaunch--;
        throw new Error("启动失败");
      }
      control.running = true;
    },
  };
  const context = { platform, home: directory, env: { APPDATA: directory, LOCALAPPDATA: directory } };
  const store = new EditorStore({
    directory,
    vault,
    settings: () => settings,
    controllers: { "trae-cn": control, "qoder-cn": control },
    context,
  });
  await store.init();
  const traeFile = path.join(
    settings.traeDataPath,
    "User",
    "globalStorage",
    "storage.json",
  );
  const setTrae = async (id, extra = {}) => {
    await fs.mkdir(path.dirname(traeFile), { recursive: true });
    await fs.writeFile(
      traeFile,
      JSON.stringify({
        [authKey]: `tc:fixture-credential-for-${id}`,
        "iCubeAuthInfo://usertag": `fixture-tag-${id}`,
        "iCubeAuthInfo://icube-dc:device": "keep-device",
        "telemetry.machineId": "keep-machine",
        "window.theme": "dark",
        ...extra,
      }),
    );
  };
  const qoderFile = path.join(settings.qoderDataPath, "auth.v1.dat");
  const setQoder = async (byte, overlay = false) => {
    await fs.mkdir(settings.qoderDataPath, { recursive: true });
    await fs.writeFile(
      qoderFile,
      Buffer.concat([
        Buffer.from("v10"),
        Buffer.alloc(platform === "win32" ? 32 : 16, byte),
      ]),
    );
    await fs.writeFile(
      path.join(settings.qoderDataPath, "Local State"),
      JSON.stringify({
        os_crypt: { encrypted_key: "fixture-same-machine-key" },
        preference: "preserve",
      }),
    );
    if (overlay)
      await fs.writeFile(
        path.join(settings.qoderDataPath, "auth-profile-overlays.v1.dat"),
        Buffer.from(`opaque-overlay-${byte}`),
      );
    else
      await fs.rm(
        path.join(settings.qoderDataPath, "auth-profile-overlays.v1.dat"),
        { force: true },
      );
  };
  return {
    directory,
    settings,
    vault,
    store,
    control,
    traeFile,
    qoderFile,
    setTrae,
    setQoder,
    context,
  };
}

test("Trae capture requires cloud login key; device entries alone are not an account", async (t) => {
  const f = await fixture(t);
  await f.setTrae("a");
  const root = JSON.parse(await fs.readFile(f.traeFile));
  delete root[authKey];
  await fs.writeFile(f.traeFile, JSON.stringify(root));
  assert.equal(
    hasEditorLogin(await readEditorAuth("trae-cn", f.settings.traeDataPath)),
    false,
  );
  await assert.rejects(f.store.capture("trae-cn", "A"), /先在/);
});
test("Trae restores only four login keys, preserving devices, preferences and database", async (t) => {
  const f = await fixture(t);
  await f.setTrae("a");
  const account = await f.store.capture("trae-cn", "A");
  const db = path.join(path.dirname(f.traeFile), "state.vscdb");
  await fs.writeFile(db, "unchanged-database");
  await f.setTrae("b", {
    [serverKey]: { oldAccountCache: "remove" },
    "window.theme": "light",
  });
  await f.store.switchAccount("trae-cn", account.id);
  const after = JSON.parse(await fs.readFile(f.traeFile));
  assert.match(after[authKey], /for-a$/);
  assert.equal(after[serverKey], undefined);
  assert.equal(after["window.theme"], "light");
  assert.equal(after["telemetry.machineId"], "keep-machine");
  assert.equal(after["iCubeAuthInfo://icube-dc:device"], "keep-device");
  assert.equal(await fs.readFile(db, "utf8"), "unchanged-database");
  assert.equal(f.store.records.length, 2);
  assert.ok(f.store.records.some((item) => item.profile.automatic));
  assert.ok(
    !(await fs.readFile(f.store.file, "utf8")).includes("fixture-credential"),
  );
});
test("capture of same ciphertext retains name, favorite and stable snapshot ID", async (t) => {
  const f = await fixture(t);
  await f.setTrae("a");
  const a = await f.store.capture("trae-cn", "A");
  await f.store.edit("trae-cn", a.id, { favorite: true, note: "work" });
  const again = await f.store.capture("trae-cn", "new name");
  assert.equal(again.id, a.id);
  assert.equal(again.nickname, "A");
  assert.equal(again.favorite, true);
  assert.equal(again.note, "work");
  await assert.rejects(f.store.switchAccount("qoder-cn", a.id), /未找到/);
});
test("exit failure does not write credentials or create a recovery journal", async (t) => {
  const f = await fixture(t);
  await f.setTrae("a");
  const a = await f.store.capture("trae-cn", "A");
  await f.setTrae("b");
  const before = await fs.readFile(f.traeFile);
  f.control.failStop = true;
  await assert.rejects(f.store.switchAccount("trae-cn", a.id), /退出失败/);
  assert.deepEqual(await fs.readFile(f.traeFile), before);
  await assert.rejects(fs.access(f.store.recoveryPath("trae-cn")));
});
test("fresh credentials written during graceful exit are preserved as outgoing snapshot", async (t) => {
  const f = await fixture(t);
  await f.setTrae("a");
  const a = await f.store.capture("trae-cn", "A");
  await f.setTrae("b");
  f.control.afterStop = () => f.setTrae("renewed-b");
  await f.store.switchAccount("trae-cn", a.id);
  assert.ok(
    f.store.records.some((record) =>
      f.store
        .unprotect(record.encrypted, "trae-cn")
        .entries[authKey].endsWith("renewed-b"),
    ),
  );
});
test("failed launch rolls back login fields and preserves current non-auth preferences", async (t) => {
  const f = await fixture(t);
  await f.setTrae("a");
  const a = await f.store.capture("trae-cn", "A");
  await f.setTrae("b", { "window.theme": "light" });
  f.control.running = true;
  f.control.failLaunch = 1;
  await assert.rejects(f.store.switchAccount("trae-cn", a.id), /启动失败/);
  const after = JSON.parse(await fs.readFile(f.traeFile));
  assert.match(after[authKey], /for-b$/);
  assert.equal(after["window.theme"], "light");
  assert.equal(f.control.running, true);
  await assert.rejects(fs.access(f.store.recoveryPath("trae-cn")));
});
test("Qoder opaque auth and overlays restore together without rewriting Local State", async (t) => {
  const f = await fixture(t);
  await f.setQoder(1, true);
  const a = await f.store.capture("qoder-cn", "Q A");
  const oldAuth = await fs.readFile(f.qoderFile);
  const overlay = path.join(
    f.settings.qoderDataPath,
    "auth-profile-overlays.v1.dat",
  );
  const oldOverlay = await fs.readFile(overlay);
  await f.setQoder(2, true);
  const local = path.join(f.settings.qoderDataPath, "Local State"),
    before = await fs.readFile(local);
  await f.store.switchAccount("qoder-cn", a.id);
  assert.deepEqual(await fs.readFile(f.qoderFile), oldAuth);
  assert.deepEqual(await fs.readFile(overlay), oldOverlay);
  assert.deepEqual(await fs.readFile(local), before);
});
test("Qoder key binding changes reject restore and retain the current encrypted login", async (t) => {
  const f = await fixture(t, "win32");
  await f.setQoder(1);
  const a = await f.store.capture("qoder-cn", "Q A");
  await f.setQoder(2);
  await fs.writeFile(
    path.join(f.settings.qoderDataPath, "Local State"),
    JSON.stringify({ os_crypt: { encrypted_key: "new-key" } }),
  );
  const before = await fs.readFile(f.qoderFile);
  await assert.rejects(f.store.switchAccount("qoder-cn", a.id), /绑定已变化/);
  assert.deepEqual(await fs.readFile(f.qoderFile), before);
});
test("new Qoder overlay format requires recapture instead of a partial account change", async (t) => {
  const f = await fixture(t);
  await f.setQoder(1);
  const a = await f.store.capture("qoder-cn", "Q A");
  await f.setQoder(2, true);
  const before = await fs.readFile(f.qoderFile);
  await assert.rejects(f.store.switchAccount("qoder-cn", a.id), /重新保存/);
  assert.deepEqual(await fs.readFile(f.qoderFile), before);
});
test("truncated Qoder ciphertext and cross-region data paths fail closed", async (t) => {
  const f = await fixture(t);
  await f.setQoder(1);
  await fs.writeFile(f.qoderFile, Buffer.from("v10-short"));
  await assert.rejects(f.store.capture("qoder-cn", "Q"), /不完整|格式/);
  await assert.rejects(
    readEditorAuth("trae-cn", path.join(f.directory, "Trae")),
    /国内版/,
  );
  await assert.rejects(
    readEditorAuth("qoder-cn", path.join(f.directory, "com.qoder.app.stable")),
    /国内版/,
  );
});
test("opaque snapshots and public summaries never contain credential bytes", async (t) => {
  const f = await fixture(t);
  await f.setTrae("a");
  await f.store.capture("trae-cn", "A");
  const raw = JSON.stringify(await f.store.snapshots());
  assert.ok(!raw.includes("tc:fixture"));
  assert.ok(!raw.includes("encrypted"));
  assert.ok(!raw.includes("fingerprint"));
  const state = JSON.parse(raw);
  assert.equal(state["trae-cn"].accounts.length, 1);
  assert.equal(state["qoder-cn"].accounts.length, 0);
});
test("an interrupted switch can be restored, but newer external login is never overwritten", async (t) => {
  const f = await fixture(t);
  await f.setTrae("a");
  const before = await readEditorAuth("trae-cn", f.settings.traeDataPath);
  await f.setTrae("b");
  const target = await readEditorAuth("trae-cn", f.settings.traeDataPath);
  const journal = {
    version: 1,
    provider: "trae-cn",
    directory: f.settings.traeDataPath,
    before,
    target,
    at: Date.now(),
  };
  await fs.writeFile(
    f.store.recoveryPath("trae-cn"),
    JSON.stringify({
      version: 1,
      encrypted: f.vault.encrypt(JSON.stringify(journal)).toString("base64"),
    }),
  );
  assert.ok(
    !(await fs.readFile(f.store.recoveryPath("trae-cn"), "utf8")).includes(
      "fixture-credential",
    ),
  );
  await f.setTrae("c");
  await assert.rejects(f.store.restore("trae-cn"), /发生变化/);
  assert.match(JSON.parse(await fs.readFile(f.traeFile))[authKey], /for-c$/);
  await writeEditorAuth("trae-cn", f.settings.traeDataPath, target);
  await f.store.restore("trae-cn");
  assert.equal(
    authFingerprint(await readEditorAuth("trae-cn", f.settings.traeDataPath)),
    authFingerprint(before),
  );
});
test("corrupt vault and unavailable encryption preserve existing files", async (t) => {
  const f = await fixture(t);
  await f.setTrae("a");
  await fs.writeFile(f.store.file, "broken");
  await f.store.init();
  await assert.rejects(f.store.capture("trae-cn", "A"), /损坏/);
  assert.equal(await fs.readFile(f.store.file, "utf8"), "broken");
  f.store.loadError = null;
  f.vault.available = () => false;
  await assert.rejects(f.store.capture("trae-cn", "A"), /加密服务/);
});
test(
  "login symlinks cannot redirect reads into other clients",
  { skip: process.platform === "win32" },
  async (t) => {
    const f = await fixture(t);
    await f.setTrae("a");
    const outside = path.join(f.directory, "outside.json");
    await fs.rename(f.traeFile, outside);
    await fs.symlink(outside, f.traeFile);
    await assert.rejects(
      readEditorAuth("trae-cn", f.settings.traeDataPath),
      /类型|目录/,
    );
  },
);
test("Qoder launcher parsing supports BOM and rejects absolute or escaping executable paths", () => {
  const ini =
    "[app]\r\ninstallDir=C:\\Users\\u\\Qoder CN\\app\r\nappExecutable=Qoder CN.exe\r\n";
  assert.equal(
    parseQoderLauncher(Buffer.from(ini)),
    "C:\\Users\\u\\Qoder CN\\app\\Qoder CN.exe",
  );
  assert.equal(
    parseQoderLauncher(
      Buffer.concat([Buffer.from([255, 254]), Buffer.from(ini, "utf16le")]),
    ),
    "C:\\Users\\u\\Qoder CN\\app\\Qoder CN.exe",
  );
  assert.equal(
    parseQoderLauncher(
      Buffer.from(
        ini.replace(
          "appExecutable=Qoder CN.exe",
          "appExecutable=..\\Qoder CN.exe",
        ),
      ),
    ),
    null,
  );
  assert.equal(
    parseQoderLauncher(
      Buffer.from(
        ini.replace(
          "appExecutable=Qoder CN.exe",
          "appExecutable=C:\\evil\\Qoder CN.exe",
        ),
      ),
    ),
    null,
  );
});
test("partial Qoder writes recover both encrypted files from the journal", async (t) => {
  const f = await fixture(t);
  await f.setQoder(1, true);
  const before = await readEditorAuth("qoder-cn", f.settings.qoderDataPath);
  await f.setQoder(2, true);
  const target = await readEditorAuth("qoder-cn", f.settings.qoderDataPath);
  await fs.writeFile(
    f.qoderFile,
    Buffer.from(before.entries["auth.v1.dat"], "base64"),
  );
  const journal = {
    version: 1,
    provider: "qoder-cn",
    directory: f.settings.qoderDataPath,
    before,
    target,
    at: Date.now(),
  };
  await fs.writeFile(
    f.store.recoveryPath("qoder-cn"),
    JSON.stringify({
      version: 1,
      encrypted: f.vault.encrypt(JSON.stringify(journal)).toString("base64"),
    }),
  );
  await f.store.restore("qoder-cn");
  assert.equal(
    authFingerprint(await readEditorAuth("qoder-cn", f.settings.qoderDataPath)),
    authFingerprint(before),
  );
});
test("a newer login appearing on failed launch is preserved with an encrypted recovery journal", async (t) => {
  const f = await fixture(t);
  await f.setTrae("a");
  const a = await f.store.capture("trae-cn", "A");
  await f.setTrae("b");
  f.control.launch = async () => {
    await f.setTrae("external-new-login");
    throw new Error("启动失败");
  };
  await assert.rejects(
    f.store.switchAccount("trae-cn", a.id),
    /自动恢复未完成/,
  );
  assert.match(
    JSON.parse(await fs.readFile(f.traeFile))[authKey],
    /external-new-login$/,
  );
  assert.ok((await f.store.snapshots())["trae-cn"].recoveryPending);
  const currentBytes = await fs.readFile(f.traeFile);
  await f.store.keepCurrent("trae-cn");
  assert.deepEqual(await fs.readFile(f.traeFile), currentBytes);
  assert.equal((await f.store.snapshots())["trae-cn"].recoveryPending, false);
  assert.ok(
    (await fs.readdir(f.directory)).some((name) =>
      name.startsWith("editor-recovery-archive-trae-cn-"),
    ),
  );
  f.control.launch = async () => {
    f.control.running = true;
  };
  await f.store.switchAccount("trae-cn", a.id);
  assert.match(JSON.parse(await fs.readFile(f.traeFile))[authKey], /for-a$/);
});
test("provider selection migrates old settings; missing executable prevents writes", async () => {
  assert.equal(validateSettings({ theme: "dark" }).activeProvider, "workbuddy");
  assert.equal(
    validateSettings({ ...defaults, activeProvider: "qoder-cn" })
      .activeProvider,
    "qoder-cn",
  );
  assert.throws(
    () => validateSettings({ ...defaults, activeProvider: "qoder" }),
    /客户端选择/,
  );
  const controller = new EditorController("trae-cn", () => ({}));
  controller.executable = async () => null;
  await assert.rejects(controller.assertStopped(), /退出状态/);
});
