#!/bin/zsh
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
version="${OPENUSAGE_VERSION:-0.1.4}"
build_number="${OPENUSAGE_BUILD_NUMBER:-5}"
sign_identity="${OPENUSAGE_SIGN_IDENTITY:--}"
arch_list=(${=OPENUSAGE_ARCHS:-$(uname -m)})
product_name="WorkBuddy Switch"
artifact_prefix="WorkBuddy-Switch"

if [[ ! -f "$repo_root/Package.swift" || ! -d "$repo_root/Sources/OpenUsage" ]]; then
  echo "Refusing to package outside the WorkBuddy Switch repository: $repo_root" >&2
  exit 1
fi

cd "$repo_root"
built_binaries=()
for build_arch in "${arch_list[@]}"; do
  case "$build_arch" in
    arm64|x86_64) ;;
    *)
      echo "Unsupported architecture: $build_arch" >&2
      exit 1
      ;;
  esac

  swift_args=(-c release --arch "$build_arch")
  swift build "${swift_args[@]}"
  bin_dir="$(swift build "${swift_args[@]}" --show-bin-path)"
  arch_binary="$bin_dir/OpenUsage"

  if [[ ! -x "$arch_binary" ]]; then
    echo "Release executable not found for $build_arch: $arch_binary" >&2
    exit 1
  fi
  built_binaries+=("$arch_binary")
done

if (( ${#built_binaries[@]} == 1 )); then
  binary="${built_binaries[1]}"
else
  universal_dir="$repo_root/.build/openusage-universal"
  binary="$universal_dir/OpenUsage"
  mkdir -p "$universal_dir"
  rm -f "$binary"
  lipo -create "${built_binaries[@]}" -output "$binary"
  lipo "$binary" -verify_arch "${arch_list[@]}"
fi

if [[ ! -x "$binary" ]]; then
  echo "Release executable not found: $binary" >&2
  exit 1
fi

dist_dir="$repo_root/dist"
app="$dist_dir/$product_name.app"
staging="$dist_dir/dmg-root"
iconset="$dist_dir/AppIcon.iconset"
rm -rf "$app" "$staging" "$iconset"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources" "$staging" "$iconset"

cp "$binary" "$app/Contents/MacOS/OpenUsage"
strip -S "$app/Contents/MacOS/OpenUsage"
cp "$repo_root/packaging/Info.plist" "$app/Contents/Info.plist"

/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $version" "$app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $build_number" "$app/Contents/Info.plist"

icon_source="$repo_root/Sources/OpenUsage/Resources/AppIcon.png"
cp "$icon_source" "$app/Contents/Resources/AppIcon.png"
sips -z 16 16 "$icon_source" --out "$iconset/icon_16x16.png" >/dev/null
sips -z 32 32 "$icon_source" --out "$iconset/icon_16x16@2x.png" >/dev/null
sips -z 32 32 "$icon_source" --out "$iconset/icon_32x32.png" >/dev/null
sips -z 64 64 "$icon_source" --out "$iconset/icon_32x32@2x.png" >/dev/null
sips -z 128 128 "$icon_source" --out "$iconset/icon_128x128.png" >/dev/null
sips -z 256 256 "$icon_source" --out "$iconset/icon_128x128@2x.png" >/dev/null
sips -z 256 256 "$icon_source" --out "$iconset/icon_256x256.png" >/dev/null
sips -z 512 512 "$icon_source" --out "$iconset/icon_256x256@2x.png" >/dev/null
sips -z 512 512 "$icon_source" --out "$iconset/icon_512x512.png" >/dev/null
cp "$icon_source" "$iconset/icon_512x512@2x.png"
iconutil -c icns "$iconset" -o "$app/Contents/Resources/AppIcon.icns"

if [[ "$sign_identity" == "-" ]]; then
  codesign \
    --force \
    --deep \
    --sign - \
    --entitlements "$repo_root/packaging/OpenUsage.entitlements" \
    "$app"
else
  codesign \
    --force \
    --deep \
    --options runtime \
    --timestamp \
    --sign "$sign_identity" \
    --entitlements "$repo_root/packaging/OpenUsage.entitlements" \
    "$app"
fi
codesign --verify --deep --strict --verbose=2 "$app"

cp -R "$app" "$staging/$product_name.app"
ln -s /Applications "$staging/Applications"

arch_label="${(j:-:)arch_list}"
if (( ${#arch_list[@]} > 1 )); then
  arch_label="universal"
fi
dmg="$dist_dir/${artifact_prefix}-${version}-${arch_label}.dmg"
zip="$dist_dir/${artifact_prefix}-${version}-${arch_label}.zip"
rm -f "$dmg" "$zip"

hdiutil create \
  -volname "$product_name" \
  -srcfolder "$staging" \
  -ov \
  -format UDZO \
  "$dmg"

if [[ -n "${OPENUSAGE_NOTARY_PROFILE:-}" && "$sign_identity" != "-" ]]; then
  xcrun notarytool submit "$dmg" \
    --keychain-profile "$OPENUSAGE_NOTARY_PROFILE" \
    --wait
  xcrun stapler staple "$app"
  xcrun stapler staple "$dmg"
fi

ditto -c -k --sequesterRsrc --keepParent "$app" "$zip"

echo "APP=$app"
echo "DMG=$dmg"
echo "ZIP=$zip"
