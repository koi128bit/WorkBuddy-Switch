import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
let setLinuxAutostart;
try {
  ({ setLinuxAutostart } = await import("../desktop/autostart.mjs"));
} catch {}
test("Linux autostart writes a quoted freedesktop entry under XDG_CONFIG_HOME and can remove it", async (t) => {
  assert.equal(typeof setLinuxAutostart, "function");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wb-autostart-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = await setLinuxAutostart(
    true,
    "/opt/WorkBuddy Switch/WorkBuddy Switch",
    { home: root, env: { XDG_CONFIG_HOME: root } },
  );
  const entry = await fs.readFile(file, "utf8");
  assert.ok(file.startsWith(path.join(root, "autostart")));
  assert.match(entry, /Exec="\/opt\/WorkBuddy Switch\/WorkBuddy Switch"/);
  assert.match(entry, /Terminal=false/);
  await setLinuxAutostart(false, "/opt/app", {
    home: root,
    env: { XDG_CONFIG_HOME: root },
  });
  await assert.rejects(fs.stat(file), { code: "ENOENT" });
  await assert.rejects(
    setLinuxAutostart(true, "/opt/app\nExec=bad", { home: root, env: {} }),
    /路径/,
  );
});
