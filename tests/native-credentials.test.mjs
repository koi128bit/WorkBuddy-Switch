import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { encryptChromium } from "../desktop/credential-codecs.mjs";
let NativeCredentials;
try {
  ({ NativeCredentials } = await import("../desktop/native-credentials.mjs"));
} catch {}
test("Qoder uses region-specific OS key service without exposing the secret", async () => {
  assert.equal(typeof NativeCredentials, "function");
  const calls = [];
  const service = new NativeCredentials({
    platform: "darwin",
    controllers: {},
    settings: () => ({}),
    run: async (file, args) => {
      calls.push({ file, args });
      return { stdout: "fixture-password\n" };
    },
  });
  const native = encryptChromium(
    JSON.stringify({ token: "secret", user: { id: "7", name: "林" } }),
    { platform: "darwin", password: "fixture-password" },
  );
  const account = await service.identify(
    "qoder-cn",
    { entries: { "auth.v1.dat": native.toString("base64") } },
    "/fixture",
  );
  assert.equal(account.uid, "7");
  assert.equal(
    calls[0].args[calls[0].args.indexOf("-s") + 1],
    "Qoder CN App Safe Storage",
  );
  await assert.rejects(
    service.identify(
      "qoder-global",
      { entries: { "auth.v1.dat": native.toString("base64") } },
      "/fixture",
      { interactive: false },
    ),
    /读取|凭据/,
  );
  assert.equal(calls.length, 1);
});
test("Trae plain native identity is recognized without looking up system keys", async () => {
  assert.equal(typeof NativeCredentials, "function");
  const service = new NativeCredentials({
    controllers: {},
    settings: () => ({}),
    run: async () => {
      throw new Error("must not read");
    },
  });
  assert.equal(
    (
      await service.identify(
        "trae-global",
        {
          entries: {
            "iCubeAuthInfo://icube.cloudide": { userId: "8", token: "fixture" },
          },
        },
        "/fixture",
      )
    ).uid,
    "8",
  );
});
test("Qoder OAuth context reads existing desktop machine ID and does not create device IDs", async (t) => {
  assert.equal(typeof NativeCredentials, "function");
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "wb-native-context-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const data = path.join(directory, "com.qodercn.app.stable");
  await fs.mkdir(data);
  const service = new NativeCredentials({
    platform: "linux",
    home: directory,
    env: {},
    controllers: {},
    settings: () => ({ qoderDataPath: data }),
  });
  await assert.rejects(service.context("qoder-cn"), /初始化/);
  await fs.writeFile(path.join(data, "auth.machine-id"), "fixture-machine");
  assert.equal(
    (await service.context("qoder-cn")).machineId,
    "fixture-machine",
  );
  assert.equal(
    await fs.readFile(path.join(data, "auth.machine-id"), "utf8"),
    "fixture-machine",
  );
});
