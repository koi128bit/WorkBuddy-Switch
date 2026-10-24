import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
export function macBuildArguments(arch) {
  if (!["arm64", "x64"].includes(arch))
    throw new Error("Unsupported Mac architecture");
  return [
    "--mac",
    "pkg",
    "dmg",
    "zip",
    `--${arch}`,
    "--publish",
    "never",
    `--config.directories.output=.build/macos-${arch}`,
  ];
}
export async function collectMacArtifacts(input, output, version, arch) {
  const names = ["pkg", "dmg", "zip"].map(
    (ext) => `WorkBuddy-Switch-${version}-mac-${arch}.${ext}`,
  );
  for (const name of names)
    if (!(await fs.stat(path.join(input, name))).isFile())
      throw new Error(`Missing installer: ${name}`);
  await fs.mkdir(output, { recursive: true });
  for (const name of names)
    await fs.copyFile(path.join(input, name), path.join(output, name));
}
async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
    pkg = JSON.parse(
      await fs.readFile(path.join(root, "package.json"), "utf8"),
    );
  for (const arch of ["arm64", "x64"]) {
    const result = spawnSync(
      process.execPath,
      [
        path.join(root, "node_modules/electron-builder/cli.js"),
        ...macBuildArguments(arch),
      ],
      { cwd: root, stdio: "inherit" },
    );
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(
        `Mac ${arch} packaging failed (${result.status ?? result.signal})`,
      );
    await collectMacArtifacts(
      path.join(root, ".build", `macos-${arch}`),
      path.join(root, "dist"),
      pkg.version,
      arch,
    );
  }
}
if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
