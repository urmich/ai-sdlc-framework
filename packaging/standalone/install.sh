#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
if [ -n "${SDLC_NODE:-}" ]; then
  case "$SDLC_NODE" in /*) node=$SDLC_NODE ;; *) echo 'SDLC_NODE must be an absolute Node.js executable path' >&2; exit 1 ;; esac
else
  node=$(command -v node) || { echo 'AI SDLC requires Node.js 22+ on PATH' >&2; exit 1; }
fi
test -f "$node" && test -x "$node" || { echo 'Node.js is not an executable file' >&2; exit 1; }
node=$("$node" -e 'if(Number(process.versions.node.split(".")[0])<22)throw Error("AI SDLC requires Node.js 22+");const fs=require("node:fs");if(fs.realpathSync(process.argv[1])!==fs.realpathSync(process.execPath))throw Error("Selected Node.js runtime changed or is shadowed");process.stdout.write(process.execPath)' "$node") || exit 1
exec "$node" "$root/package/packaging/standalone/runtime.mjs" install-channel --root "$root" --node "$node" -- "$@"
