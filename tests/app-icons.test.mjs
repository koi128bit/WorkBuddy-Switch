import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
let configureIcons;
try {
  ({ configureIcons } = require("../desktop/icons.cjs"));
} catch (error) {
  if (error.code !== "MODULE_NOT_FOUND") throw error;
}

class Image {
  constructor(width = 0, height = 0) {
    this.size = { width, height };
    this.representations = new Map();
  }
  isEmpty() {
    return !this.size.width;
  }
  getSize() {
    return this.size;
  }
  resize({ width, height }) {
    return new Image(width, height);
  }
  toPNG() {
    return Buffer.from(JSON.stringify(this.size));
  }
  addRepresentation({ scaleFactor, buffer }) {
    const size = JSON.parse(buffer);
    this.representations.set(scaleFactor, size);
    this.size = {
      width: size.width / scaleFactor,
      height: size.height / scaleFactor,
    };
  }
}
function fixture(platform) {
  const assigned = [];
  const loaded = [];
  const options = {
    root: "/application",
    platform,
    app: { dock: { setIcon: (image) => assigned.push(image) } },
    nativeImage: {
      createEmpty: () => new Image(),
      createFromBuffer: (buffer) => {
        const { width, height } = JSON.parse(buffer);
        return new Image(width, height);
      },
    },
    readFile: (file) => {
      loaded.push(file);
      return Buffer.from(JSON.stringify({ width: 1024, height: 1024 }));
    },
  };
  return { options, assigned, loaded };
}
test("macOS explicitly assigns an independent full-size Dock image", () => {
  assert.equal(typeof configureIcons, "function");
  const { options, assigned, loaded } = fixture("darwin");
  const icons = configureIcons(options);
  assert.deepEqual(icons.application.getSize(), { width: 1024, height: 1024 });
  assert.deepEqual(icons.dock.getSize(), { width: 1024, height: 1024 });
  assert.equal(assigned.length, 1);
  assert.equal(assigned[0], icons.dock);
  assert.notEqual(icons.dock, icons.application);
  assert.notEqual(icons.dock, icons.tray);
  assert.ok(loaded.some((file) => file.endsWith("icon-mac.png")));
});
test("tray thumbnails include 1x, 2x and 3x images without shrinking the application icon", () => {
  const { options } = fixture("darwin");
  const icons = configureIcons(options);
  assert.deepEqual(icons.tray.getSize(), { width: 20, height: 20 });
  assert.deepEqual(
    [...icons.tray.representations],
    [
      [1, { width: 20, height: 20 }],
      [2, { width: 40, height: 40 }],
      [3, { width: 60, height: 60 }],
    ],
  );
  assert.deepEqual(icons.dock.getSize(), { width: 1024, height: 1024 });
});
test("Windows and Linux never call the macOS Dock API", () => {
  for (const platform of ["win32", "linux"]) {
    const { options, assigned, loaded } = fixture(platform);
    delete options.app.dock;
    const icons = configureIcons(options);
    assert.equal(icons.dock, null);
    assert.equal(assigned.length, 0);
    assert.equal(
      loaded.some((file) => file.endsWith("icon-mac.png")),
      false,
    );
    assert.deepEqual(icons.tray.getSize(), { width: 20, height: 20 });
  }
});
test("empty application icons are rejected instead of silently displaying a tiny placeholder", () => {
  const { options } = fixture("darwin");
  options.nativeImage.createFromBuffer = () => new Image();
  assert.throws(() => configureIcons(options), /图标/);
});

test("macOS Retina icon slots match their declared pixel sizes", () => {
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url)),
  );
  assert.equal(pkg.build.mac.icon, "assets/icon.icns");
  assert.ok(pkg.build.files.includes("assets/icon-mac.png"));
  const bytes = readFileSync(
    process.env.WB_TEST_ICNS || new URL("../assets/icon.icns", import.meta.url),
  );
  const expected = new Map([
    ["ic11", 32],
    ["ic12", 64],
    ["ic13", 256],
    ["ic14", 512],
    ["ic10", 1024],
  ]);
  assert.equal(bytes.toString("ascii", 0, 4), "icns");
  for (let offset = 8; offset < bytes.length; ) {
    const type = bytes.toString("ascii", offset, offset + 4);
    const length = bytes.readUInt32BE(offset + 4);
    assert.ok(length >= 8 && offset + length <= bytes.length);
    if (expected.has(type)) {
      assert.equal(bytes.toString("ascii", offset + 9, offset + 12), "PNG");
      const size = expected.get(type);
      assert.deepEqual(
        [bytes.readUInt32BE(offset + 24), bytes.readUInt32BE(offset + 28)],
        [size, size],
        `${type} Retina dimensions`,
      );
      expected.delete(type);
    }
    offset += length;
  }
  assert.equal(expected.size, 0, "all Retina slots and the 1024px image exist");
});
