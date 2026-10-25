import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { validateSettings } from "../desktop/settings.mjs";
const require = createRequire(import.meta.url);
const { windowMaterial } = require("../desktop/window-material.cjs");

test("macOS uses native behind-window blur and keeps text opacity independent", () => {
  const value = windowMaterial({ platform: "darwin", release: "25.0.0" });
  assert.equal(value.kind, "vibrancy");
  assert.equal(value.options.vibrancy, "under-window");
  assert.equal(value.options.backgroundColor, "#00000000");
  assert.equal(value.options.transparent, true);
  assert.equal(value.options.opacity, undefined);
});
test("Windows 11 22H2 enables Acrylic without removing the native frame", () => {
  const value = windowMaterial({ platform: "win32", release: "10.0.22621" });
  assert.equal(value.kind, "acrylic");
  assert.equal(value.options.backgroundMaterial, "acrylic");
  assert.notEqual(value.options.transparent, true);
  assert.equal(value.options.frame, undefined);
});
test("older Windows and Linux retain an opaque, usable dark window", () => {
  for (const value of [
    { platform: "win32", release: "10.0.19045" },
    { platform: "win32", release: "unknown" },
    { platform: "linux", release: "6.8" },
  ]) {
    const material = windowMaterial(value);
    assert.equal(material.kind, "opaque");
    assert.equal(material.options.backgroundColor, "#19191c");
    assert.equal(material.options.backgroundMaterial, undefined);
  }
});
test("reduce transparency, high contrast and the user's off switch disable native blur", () => {
  for (const preference of [
    { enabled: false },
    { reducedTransparency: true },
    { highContrast: true },
  ]) {
    for (const platform of ["darwin", "win32"])
      assert.equal(
        windowMaterial({ platform, release: "10.0.26100", ...preference }).kind,
        "opaque",
      );
  }
});
test("a fresh glass setting has a default, persists off and rejects non-boolean values", () => {
  assert.equal(validateSettings({}).glassEffect, true);
  assert.equal(validateSettings({ glassEffect: false }).glassEffect, false);
  assert.throws(() => validateSettings({ glassEffect: "true" }));
});
