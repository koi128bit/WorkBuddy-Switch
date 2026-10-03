import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
const files = readdirSync("tests")
  .filter((file) => file.endsWith(".test.mjs"))
  .map((file) => `tests/${file}`);
const result = spawnSync(process.execPath, ["--test", ...files], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
