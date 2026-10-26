const { readFileSync } = require("node:fs");
const path = require("node:path");

function configureIcons({
  app,
  nativeImage,
  root,
  platform = process.platform,
  readFile = readFileSync,
}) {
  const bytes = readFile(path.join(root, "assets/icon.png"));
  const application = nativeImage.createFromBuffer(bytes);
  if (application.isEmpty()) throw new Error("应用图标加载失败。");

  // Decode independent images: a tray-sized NSImage must never become the Dock
  // image, including when macOS caches an image loaded by its file path.
  const tray = nativeImage.createEmpty();
  for (const scaleFactor of [1, 2, 3]) {
    const image = nativeImage.createFromBuffer(bytes).resize({
      width: 20 * scaleFactor,
      height: 20 * scaleFactor,
      quality: "best",
    });
    tray.addRepresentation({ scaleFactor, buffer: image.toPNG() });
  }
  let dock = null;
  if (platform === "darwin") {
    dock = nativeImage.createFromBuffer(
      readFile(path.join(root, "assets/icon-mac.png")),
    );
    if (dock.isEmpty()) throw new Error("Dock 图标加载失败。");
    dock = dock.resize({ width: 1024, height: 1024, quality: "best" });
    app.dock.setIcon(dock);
  }
  return { application, dock, tray };
}

module.exports = { configureIcons };
