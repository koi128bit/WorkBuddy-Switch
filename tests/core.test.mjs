import test from "node:test";
import assert from "node:assert/strict";
import { parseAuth, mergeAuth, credentialKey } from "../desktop/auth.mjs";
import {
  defaults,
  validateSettings,
  resolvePaths,
} from "../desktop/settings.mjs";
import { encodeBackup, decodeBackup } from "../desktop/backup.mjs";
import path from "node:path";

const auth = (id, extra = {}) =>
  JSON.stringify({
    account: { uid: id, nickname: `Account ${id}`, phoneNumber: "13812345678" },
    auth: { accessToken: `fixture-${id}` },
    ...extra,
  });
test("rejects missing identity and token without echoing secrets", () => {
  assert.throws(
    () => parseAuth('{"auth":{"accessToken":"SECRET"}}'),
    /缺少账号/,
  );
  assert.throws(() => parseAuth("invalid"), /有效的 JSON/);
});
test("masks phone and normalizes numeric identity", () => {
  assert.equal(parseAuth(auth(17)).id, "17");
  assert.equal(parseAuth(auth("a")).phoneHint, "138****5678");
});
test("switch merging retains local machine fields and combines account list", () => {
  const merged = JSON.parse(
    mergeAuth(
      auth("a", {
        machineId: "local",
        customSetting: 1,
        allAccounts: [{ uid: "a" }],
      }),
      auth("b", { machineId: "remote" }),
    ),
  );
  assert.equal(merged.machineId, "local");
  assert.equal(merged.customSetting, 1);
  assert.equal(merged.auth.accessToken, "fixture-b");
  assert.equal(merged.account.uid, "b");
  assert.deepEqual(
    merged.allAccounts.map((x) => x.uid),
    ["a", "b"],
  );
});
test("credential names cannot contain path traversal", () => {
  assert.match(credentialKey("../../unsafe"), /^[a-f0-9]{64}$/);
});
test("settings reject unknown keys, wrong types and unsafe paths", () => {
  for (const value of [
    { debug: true },
    { theme: "purple" },
    { refreshSeconds: -1 },
    { privacyMode: "false" },
    { dataPath: "../secret" },
    { backupLimit: 0 },
  ])
    assert.throws(() => validateSettings(value));
  assert.equal(validateSettings({ privacyMode: false }).privacyMode, false);
});
test("Windows paths use LOCALAPPDATA, not Roaming", () => {
  const paths = resolvePaths(defaults, {
    platform: "win32",
    home: "/fixtures/home",
    env: { LOCALAPPDATA: "/fixtures/local" },
  });
  assert.equal(
    paths.auth,
    path.join(
      "/fixtures/local",
      "CodeBuddyExtension",
      "Data",
      "Public",
      "auth",
      "workbuddy-desktop.info",
    ),
  );
});
test("portable backup encrypts credentials and round trips", () => {
  const records = [
    { raw: auth("a"), profile: { id: "a", nickname: "Example" } },
  ];
  const encoded = encodeBackup(records, "test-password");
  assert.ok(!encoded.includes("fixture-a"));
  assert.deepEqual(decodeBackup(encoded, "test-password"), records);
});
test("backup rejects wrong password, tampering and identity mismatch", () => {
  const encoded = encodeBackup(
    [{ raw: auth("a"), profile: { id: "a" } }],
    "test-password",
  );
  assert.throws(() => decodeBackup(encoded, "wrong-password"), /密码/);
  const changed = JSON.parse(encoded);
  changed.tag = Buffer.alloc(16).toString("base64");
  assert.throws(
    () => decodeBackup(JSON.stringify(changed), "test-password"),
    /修改/,
  );
  assert.throws(
    () =>
      decodeBackup(
        encodeBackup(
          [{ raw: auth("a"), profile: { id: "b" } }],
          "test-password",
        ),
        "test-password",
      ),
    /身份/,
  );
});
