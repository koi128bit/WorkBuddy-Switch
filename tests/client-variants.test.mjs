import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  EditorController,
  parseQoderLauncher,
} from "../desktop/editor-controller.mjs";
import { WorkBuddyController } from "../desktop/controller.mjs";
import { defaults, validateSettings } from "../desktop/settings.mjs";
import { clients } from "../desktop/client-registry.mjs";
import {
  readEditorAuth,
  writeEditorAuth,
  hasEditorLogin,
} from "../desktop/editor-auth.mjs";

test("all region selectors and custom paths survive validated settings", () => {
  for (const provider of Object.keys(clients))
    assert.equal(
      validateSettings({ ...defaults, activeProvider: provider })
        .activeProvider,
      provider,
    );
  assert.equal(
    validateSettings({
      ...defaults,
      workbuddyGlobalDataPath: "/tmp/global",
      traeGlobalDataPath: "/tmp/Trae",
      qoderGlobalDataPath: "/tmp/com.qoder.app.stable",
    }).workbuddyGlobalDataPath,
    "/tmp/global",
  );
});
test("Qoder launcher distinguishes CN and global executable names", () => {
  const data = Buffer.from(
    "installDir=C:\\Qoder\nappExecutable=app\\Qoder.exe",
  );
  assert.equal(
    parseQoderLauncher(data, "Qoder.exe"),
    "C:\\Qoder\\app\\Qoder.exe",
  );
  assert.equal(parseQoderLauncher(data), null);
});
test("Linux discovers custom native executables without invoking Windows tools", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wb-platform-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const binary = path.join(root, "qoder");
  await fs.writeFile(binary, "fixture", { mode: 0o700 });
  const editor = new EditorController(
    "qoder-global",
    () => ({ ...defaults, qoderGlobalExecutablePath: binary }),
    { platform: "linux", home: root, env: {} },
  );
  assert.equal(await editor.executable(), binary);
  const wb = new WorkBuddyController(
    () => ({ ...defaults, executablePath: binary }),
    { platform: "linux", home: root, env: {}, provider: "workbuddy-global" },
  );
  assert.equal(await wb.executable(), binary);
  assert.equal(
    editor.matching(
      [
        { pid: 1, executable: binary, command: binary },
        { pid: 2, executable: binary + "-ide", command: binary + "-ide" },
      ],
      binary,
    ).length,
    1,
  );
});
test("global Trae snapshots preserve device state and cannot cross regions", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wb-region-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dir = path.join(root, "Trae"),
    file = path.join(dir, "User/globalStorage/storage.json");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    JSON.stringify({
      "iCubeAuthInfo://icube.cloudide": { token: "fixture-token", userId: "a" },
      "telemetry.machineId": "unchanged",
    }),
  );
  const doc = await readEditorAuth("trae-global", dir, { platform: "linux" });
  assert.equal(hasEditorLogin(doc), true);
  await writeEditorAuth("trae-global", dir, doc, { platform: "linux" });
  assert.equal(
    JSON.parse(await fs.readFile(file))["telemetry.machineId"],
    "unchanged",
  );
  await assert.rejects(readEditorAuth("trae-cn", dir), /目录/);
});
test("Linux Qoder v11 snapshots retain their own regional binding", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wb-qoder-linux-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dir = path.join(root, "com.qoder.app.stable");
  await fs.mkdir(dir);
  await fs.writeFile(
    path.join(dir, "auth.v1.dat"),
    Buffer.concat([Buffer.from("v11"), Buffer.alloc(16, 1)]),
  );
  const doc = await readEditorAuth("qoder-global", dir, { platform: "linux" });
  assert.equal(hasEditorLogin(doc), true);
  await writeEditorAuth("qoder-global", dir, doc, { platform: "linux" });
});
