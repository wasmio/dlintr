#!/usr/bin/env bash
#
# Builds hadolint's WASI CLI from the pinned `hadolint` submodule and
# slims it with Binaryen.
#
# The output is a WASI preview1 *command* module: it imports
# `wasi_snapshot_preview1` and exports `_start`, so every WASI host can run it —
# `node:wasi` here, `wasmtime`/`wazero` elsewhere. That is deliberately not what
# upstream publishes to GitHub Pages, which is a JSFFI *reactor* wired to the
# website's DOM (`#lint`, `#dockerfile__code`).
#
# Requires the GHC wasm toolchain, which `wasm/toolchain.sh` installs and this
# script sources for itself. That is the *command* build, kept because it is the
# reference the byte-equality test compares the reactor against; the reactor is
# `wasm/build-reactor.sh`, and it is what the package ships.
#
# Usage: wasm/build.sh [output.wasm]
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="$root/hadolint"
patch="$root/wasm/hadolint-wasm32-cli.patch"
output="${1:-$root/hadolint.wasm}"

if [ ! -f "$source_dir/hadolint.cabal" ]; then
  echo "wasm: hadolint is empty — run 'git submodule update --init'" >&2
  exit 1
fi

# `wasm32-wasi-cabal` is ghc-wasm-meta's own wrapper: it pins
# --with-compiler/--with-hc-pkg/--with-hsc2hs/--with-haddock at the wasm
# toolchain, so Cabal never reaches for a native ghc. Everything the ghcup-based
# flow needed on top of that (PATH juggling, symlinking ghc into ~/.ghcup) is
# unnecessary here, because the wasm toolchain is the only one installed.
# The toolchain's `wasm-env` carries the PATH; see the note in
# `wasm/build-reactor.sh` for why this is sourced rather than required.
prefix="${PREFIX:-$HOME/.ghc-wasm}"
if [ -f "$prefix/wasm-env" ]; then
  # shellcheck disable=SC1091
  source "$prefix/wasm-env"
fi

for tool in wasm32-wasi-cabal wasm-opt; do
  command -v "$tool" > /dev/null || {
    echo "wasm: $tool not found on PATH — install the toolchain with wasm/toolchain.sh" >&2
    exit 1
  }
done

# Upstream marks `exe:hadolint` unbuildable on wasm32 and hands it `-threaded`,
# which wasm32-wasi cannot link. The patch lifts both and is pinned to the
# submodule commit, so it has to be rebased whenever the submodule moves.
applied=0
if git -C "$source_dir" apply --check "$patch" 2> /dev/null; then
  git -C "$source_dir" apply "$patch"
  applied=1
elif ! git -C "$source_dir" apply --reverse --check "$patch" 2> /dev/null; then
  echo "wasm: wasm/hadolint-wasm32-cli.patch no longer applies to hadolint" >&2
  echo "wasm: submodule is at $(git -C "$source_dir" rev-parse --short HEAD) — rebase the patch" >&2
  exit 1
fi

# Leave the submodule pristine: a build is not a reason for the superproject to
# report a dirty tree.
if [ "$applied" = 1 ]; then
  trap 'git -C "$source_dir" checkout -- hadolint.cabal' EXIT
fi

(
  cd "$source_dir"
  wasm32-wasi-cabal build exe:hadolint
  wasm32-wasi-cabal list-bin exe:hadolint
) | tee /tmp/wasm-bin.txt >&2
bin="$(tail -n 1 /tmp/wasm-bin.txt)"

# `-Oz` is the size profile and the reason this step exists at all. Against the
# v2.15.1 source: GHC's raw output is 22.34 MiB, a Binaryen round-trip with no
# passes already drops that to 14.38 MiB (GHC does not emit minimally encoded
# wasm), and `-Oz --converge` reaches 7.78 MiB — 1.65 MiB once brotli'd. `-O3`
# stops at 14.34 MiB and compresses worse, so size is the profile to pick: every
# install downloads this file.
wasm-opt -Oz --converge -o "$output" "$bin"

echo "wasm: wrote $output ($(du -h "$output" | cut -f1))"
sha256sum "$output"
