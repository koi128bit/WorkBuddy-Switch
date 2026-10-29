import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createSystemVault } from "../desktop/platform.mjs";

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "wb-local-vault-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const calls = [];
  const engine = {
    isEncryptionAvailable: () => true,
    encryptString: () => { throw new Error("unexpected system encryption"); },
    decryptString(bytes) {
      calls.push(Buffer.from(bytes).toString());
      if (Buffer.from(bytes).toString() === "system-record") return "old credential";
      throw new Error("system record is unavailable");
    },
  };
  const options = { directory, env: { WORKBUDDY_LOCAL_VAULT: "1" } };
  return { directory, file: path.join(directory, ".local-vault-key"), calls,
    vault: () => createSystemVault(engine, "darwin", options) };
}

test("opt-in local vault authenticates records with a persisted private random key", async (t) => {
  const f = await fixture(t);
  const vault = f.vault();
  assert.equal(vault.local, true);
  const first = vault.encrypt("private credential");
  const second = vault.encrypt("private credential");
  assert.notDeepEqual(first, second, "each encryption needs a fresh nonce");
  assert.equal(first.includes(Buffer.from("private credential")), false);
  assert.equal(f.vault().decrypt(first), "private credential");
  assert.equal((await fs.readFile(f.file)).length, 32);
  if (process.platform !== "win32") assert.equal((await fs.stat(f.file)).mode & 0o777, 0o600);
  assert.deepEqual(f.calls, []);
});

test("legacy records use the real system vault without creating a replacement key", async (t) => {
  const f = await fixture(t);
  assert.equal(f.vault().decrypt(Buffer.from("system-record")), "old credential");
  assert.deepEqual(f.calls, ["system-record"]);
  await assert.rejects(fs.access(f.file), { code: "ENOENT" });
});

test("a corrupted local key is preserved and cannot be silently regenerated", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.file, "damaged", { mode: 0o600 });
  assert.throws(() => f.vault().encrypt("credential"), /密钥/);
  assert.equal(await fs.readFile(f.file, "utf8"), "damaged");
});

test("missing local keys and tampered ciphertext fail closed without trying another password", async (t) => {
  const f = await fixture(t);
  const encrypted = f.vault().encrypt("credential");
  const tampered = Buffer.from(encrypted);
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => f.vault().decrypt(tampered));
  assert.deepEqual(f.calls, []);
  await fs.unlink(f.file);
  assert.throws(() => f.vault().decrypt(encrypted), /密钥/);
  await assert.rejects(fs.access(f.file), { code: "ENOENT" });
});

test("local vault never follows a symlink to another key file", async (t) => {
  if (process.platform === "win32") return t.skip("local mode is macOS-only");
  const f = await fixture(t);
  const outside = path.join(f.directory, "outside-key");
  await fs.writeFile(outside, Buffer.alloc(32, 7), { mode: 0o600 });
  await fs.symlink(outside, f.file);
  assert.throws(() => f.vault().encrypt("credential"));
  assert.deepEqual(await fs.readFile(outside), Buffer.alloc(32, 7));
});

test("existing 16-byte local keys remain usable without replacement", async (t) => {
  const f = await fixture(t);
  const key = crypto.randomBytes(16);
  await fs.writeFile(f.file, key, { mode: 0o600 });
  const cipher = crypto.createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
  const old = Buffer.concat([Buffer.from("v10"), cipher.update("legacy local credential"), cipher.final()]);
  assert.equal(f.vault().decrypt(old), "legacy local credential");
  const current = f.vault().encrypt("new credential");
  assert.equal(f.vault().decrypt(current), "new credential");
  assert.deepEqual(await fs.readFile(f.file), key);
  assert.deepEqual(f.calls, []);
});
