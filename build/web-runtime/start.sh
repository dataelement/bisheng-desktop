#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) ;;
  *) echo 'This package requires Windows x64 and Git Bash or a compatible shell.' >&2; exit 1 ;;
esac
exec "$root/node/node.exe" "$root/dsh-offline.mjs" web "$@"
