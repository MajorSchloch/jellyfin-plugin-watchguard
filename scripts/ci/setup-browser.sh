#!/usr/bin/env bash
# Pinned upstream image; no maintained custom image or package mirror.
set -euo pipefail
test "$(uname -s)" = Linux
image="$(python3 -c 'import runpy; print(runpy.run_path("scripts/ci/browser-node.py")["IMAGE"])')"
docker pull "$image"
echo "WATCHGUARD_HOST_NODE=$(command -v node)" >> "$GITHUB_ENV"
echo "WATCHGUARD_BROWSER_IMAGE=$image" >> "$GITHUB_ENV"
mkdir -p /tmp/watchguard-browser-bin
cp scripts/ci/browser-node.py /tmp/watchguard-browser-bin/node
chmod +x /tmp/watchguard-browser-bin/node
echo /tmp/watchguard-browser-bin >> "$GITHUB_PATH"
