import { spawn } from "node:child_process";
import path from "node:path";
import electron from "electron";
const vite = spawn(
  process.execPath,
  [path.resolve("node_modules/vite/bin/vite.js")],
  { stdio: "inherit" },
);
let desktop;
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch("http://127.0.0.1:5173")).ok) break;
  } catch {
    /* Wait for the local server. */
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
}
desktop = spawn(electron, ["."], {
  stdio: "inherit",
  env: { ...process.env, WB_SWITCH_DEV_URL: "http://127.0.0.1:5173" },
});
const stop = () => {
  desktop?.kill();
  vite.kill();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
desktop.on("exit", () => {
  vite.kill();
});
