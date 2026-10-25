/** Keep platform material choices separate from the renderer's glass styling. */
function windowMaterial({
  platform,
  release = "",
  enabled = true,
  reducedTransparency = false,
  highContrast = false,
  panel = false,
}) {
  const opaque = {
    kind: "opaque",
    options: {
      backgroundColor: "#19191c",
      ...(platform === "darwin" ? { transparent: true } : {}),
    },
  };
  if (!enabled || reducedTransparency || highContrast) return opaque;
  if (platform === "darwin")
    return {
      kind: "vibrancy",
      options: {
        transparent: true,
        backgroundColor: "#00000000",
        vibrancy: panel ? "popover" : "under-window",
        visualEffectState: "active",
      },
    };
  const parts = release.split(".").map(Number);
  if (
    platform === "win32" &&
    parts[0] >= 10 &&
    Number.isInteger(parts[2]) &&
    parts[2] >= 22621
  )
    return {
      kind: "acrylic",
      options: { backgroundColor: "#00000000", backgroundMaterial: "acrylic" },
    };
  return opaque;
}
module.exports = { windowMaterial };
