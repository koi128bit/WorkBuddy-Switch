import fs from "node:fs/promises";
import path from "node:path";

const destination = path.join("renderer", "licenses");
await fs.mkdir(destination, { recursive: true });
await fs.copyFile(
  path.join("node_modules", "electron", "dist", "LICENSES.chromium.html"),
  path.join(destination, "LICENSES.chromium.html"),
);
