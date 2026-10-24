#!/usr/bin/env bash
set -euo pipefail
export XDG_CURRENT_DESKTOP=GNOME
printf 'isolated-ci-keyring\n' | gnome-keyring-daemon --unlock --components=secrets
printf 'isolated-probe' | secret-tool store --label='WorkBuddy Switch isolated CI probe' application workbuddy-switch-ci
test "$(secret-tool lookup application workbuddy-switch-ci)" = isolated-probe
secret-tool clear application workbuddy-switch-ci
xvfb-run -a npm run test:smoke
