#!/bin/zsh
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
build_dir="$repo_root/.build/integration-check"
host_arch="$(uname -m)"
mkdir -p "$build_dir"

swiftc \
  -parse-as-library \
  -target "${host_arch}-apple-macosx13.0" \
  "$repo_root/Sources/OpenUsage/Models.swift" \
  "$repo_root/Sources/OpenUsage/AppPaths.swift" \
  "$repo_root/Sources/OpenUsage/AuthDocument.swift" \
  "$repo_root/Sources/OpenUsage/SQLiteDatabase.swift" \
  "$repo_root/Sources/OpenUsage/SessionStore.swift" \
  "$repo_root/Sources/OpenUsage/UsageParser.swift" \
  "$repo_root/Sources/OpenUsage/UsageService.swift" \
  "$repo_root/Sources/OpenUsage/WorkBuddyController.swift" \
  "$repo_root/Sources/OpenUsage/TraeSupport.swift" \
  "$repo_root/Sources/OpenUsage/TraeUsageService.swift" \
  "$repo_root/Tests/IntegrationCheck.swift" \
  -framework AppKit \
  -framework Security \
  -lsqlite3 \
  -o "$build_dir/OpenUsageIntegrationCheck"

"$build_dir/OpenUsageIntegrationCheck"
