import { spawnSync } from "node:child_process";
import electron from "electron";
import { readdirSync } from "node:fs";
const files = readdirSync("tests")
  .filter((file) => file.endsWith(".test.mjs"))
  .map((file) => `tests/${file}`);
const result = spawnSync(electron, ["--test", ...files], {
  stdio: "inherit",
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
});
process.exit(result.status ?? 1);
