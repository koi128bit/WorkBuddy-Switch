import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
const exec = promisify(execFile);
if (process.env.GITHUB_ACTIONS !== "true" || process.platform !== "darwin")
  throw new Error("Installer integration runs only on a macOS GitHub runner.");
const metadata = JSON.parse(await fs.readFile("package.json", "utf8")),
  arch = process.arch === "arm64" ? "arm64" : "x64",
  target = "/Applications/WorkBuddy Switch.app";
try {
  await fs.access(target);
  throw new Error("Unexpected existing application on the runner.");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const data = path.join(
  os.homedir(),
  "Library/Application Support/WorkBuddy Switch",
);
await fs.mkdir(data, { recursive: true });
const sentinel = path.join(data, "installer-upgrade-fixture.json");
const original = JSON.stringify({
  account: "isolated-upgrade-fixture",
  settings: "preserve",
});
await fs.writeFile(sentinel, original);
await fs.mkdir(path.join(target, "Contents"), { recursive: true });
await fs.writeFile(
  path.join(target, "Contents/Info.plist"),
  `<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.koi128bit.workbuddy-switch</string><key>CFBundleName</key><string>WorkBuddy Switch</string><key>CFBundleShortVersionString</key><string>1.4.0</string><key>CFBundleVersion</key><string>1.4.0</string></dict></plist>`,
);
await fs.writeFile(
  path.join(target, "obsolete-version-file.txt"),
  "old bundle content",
);
const pkg = path.resolve(
  "dist",
  `WorkBuddy-Switch-${metadata.version}-mac-${arch}.pkg`,
);
const { stdout } = await exec(
  "/usr/bin/sudo",
  ["-n", "/usr/sbin/installer", "-pkg", pkg, "-target", "/"],
  { timeout: 180000, maxBuffer: 2 * 1024 * 1024 },
);
console.log(stdout.trim());
const read = async (field) =>
  (
    await exec("/usr/bin/plutil", [
      "-extract",
      field,
      "raw",
      "-o",
      "-",
      path.join(target, "Contents/Info.plist"),
    ])
  ).stdout.trim();
if (
  (await read("CFBundleIdentifier")) !== metadata.build.appId ||
  (await read("CFBundleShortVersionString")) !== metadata.version
)
  throw new Error("Installer did not replace the canonical bundle.");
try {
  await fs.access(path.join(target, "obsolete-version-file.txt"));
  throw new Error("Upgrade retained obsolete bundle files.");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if ((await fs.readFile(sentinel, "utf8")) !== original)
  throw new Error("Upgrade changed the user data directory.");
const apps = (await fs.readdir("/Applications")).filter((name) =>
  /^WorkBuddy Switch.*\.app$/.test(name),
);
if (apps.length !== 1 || apps[0] !== "WorkBuddy Switch.app")
  throw new Error("Upgrade created duplicate app bundles.");
await exec("/usr/bin/codesign", ["--verify", "--deep", "--strict", target], {
  timeout: 60000,
});
console.log(
  "PASS: native PKG replaces 1.4.0 at /Applications, removes obsolete bundle files, preserves user data and leaves one application.",
);
