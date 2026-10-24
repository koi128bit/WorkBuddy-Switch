#!/usr/bin/env bash
set -euo pipefail
printf 'isolated-ci-keyring\n' | gnome-keyring-daemon --unlock --components=secrets
xvfb-run -a npm run test:smoke
