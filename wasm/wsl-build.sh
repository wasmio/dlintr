#!/usr/bin/env bash
#
# The Windows half of `scripts/build-wasm.mjs`: runs *inside* WSL2 and builds the
# reactor out of the checkout, which is passed as a WSL path.
#
# It is a script rather than a long `wsl -e bash -c '...'` because quoting a
# multi-line program through wsl.exe is exactly where this kind of thing goes
# wrong, and because a file can be run by hand when it misbehaves.
#
# Usage: wsl-build.sh <checkout, as a WSL path>
set -euo pipefail

checkout="${1:?usage: wsl-build.sh <checkout as a WSL path>}"
build="${DLINTR_WSL_BUILD_DIR:-$HOME/dlintr-wasm-build}"
prefix="${PREFIX:-$HOME/.ghc-wasm}"

if [ ! -f "$prefix/wasm-env" ]; then
  echo "wasm: no toolchain at $prefix" >&2
  echo "wasm: run wasm/toolchain.sh inside WSL first (see wasm/README.md)" >&2
  exit 1
fi

# The build happens in WSL's own filesystem, not over the /mnt/<drive> mount the
# checkout is on. cabal writes `dist-newstyle` as thousands of small files, and
# 9p turns that into the difference between a build and a timeout. Only the
# sources are copied in, so this is a few tens of megabytes.
rm -rf "$build"
mkdir -p "$build"
cp -a "$checkout/hadolint" "$checkout/wasm" "$build/"

# shellcheck disable=SC1091
source "$prefix/wasm-env"

# Same reason as in `wasm/toolchain.sh`: `/tmp` is a tmpfs here, and `mktemp -d`
# inside the cabal build would otherwise land on it.
mkdir -p "$HOME/tmp"
export TMPDIR="$HOME/tmp"

cd "$build"
bash wasm/build-reactor.sh

# The tests run natively on Windows and load both files from the package root,
# so they have to cross back out of the Linux filesystem.
cp "$build/hadolint.wasm" "$build/ghc_wasm_jsffi.js" "$checkout/"

echo "wasm: copied hadolint.wasm and ghc_wasm_jsffi.js into $checkout"
