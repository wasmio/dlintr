#!/usr/bin/env bash
#
# Builds hadolint's WASI CLI from the pinned `vendor/hadolint` submodule and
# slims it with Binaryen.
#
# The output is a WASI preview1 *command* module: it imports
# `wasi_snapshot_preview1` and exports `_start`, so every WASI host can run it —
# `node:wasi` here, `wasmtime`/`wazero` elsewhere. That is deliberately not what
# upstream publishes to GitHub Pages, which is a JSFFI *reactor* wired to the
# website's DOM (`#lint`, `#dockerfile__code`).
#
# Requires the GHC wasm toolchain on PATH (`source ~/.ghc-wasm/env`), a `cabal`,
# and `wasm-opt`. `.github/workflows/wasm.yml` installs all three at pinned
# versions; `wasm/README.md` describes the local equivalent.
#
# Usage: wasm/build.sh [output.wasm]
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="$root/vendor/hadolint"
patch="$root/wasm/hadolint-wasm32-cli.patch"
output="${1:-$root/hadolint.wasm}"

if [ ! -f "$source_dir/hadolint.cabal" ]; then
  echo "wasm: vendor/hadolint is empty — run 'git submodule update --init'" >&2
  exit 1
fi

for tool in cabal wasm-opt; do
  command -v "$tool" > /dev/null || {
    echo "wasm: $tool not found on PATH" >&2
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
  echo "wasm: wasm/hadolint-wasm32-cli.patch no longer applies to vendor/hadolint" >&2
  echo "wasm: submodule is at $(git -C "$source_dir" rev-parse --short HEAD) — rebase the patch" >&2
  exit 1
fi

# Leave the submodule pristine: a build is not a reason for the superproject to
# report a dirty tree.
if [ "$applied" = 1 ]; then
  trap 'git -C "$source_dir" checkout -- hadolint.cabal' EXIT
fi

# Resolve the wasm cross compiler. `source ~/.ghc-wasm/env` puts it on PATH, so
# preferring that avoids `ghcup whereis ghc` — unversioned, it resolves against
# ghcup's *native* ghc and fails, and a failed command substitution does not
# trip `set -e`, so the path silently collapses to the filesystem root. The
# versioned form is a fallback, and the guard below refuses to continue without
# a real compiler either way.
ghc_bin="${GHC_WASM_BIN:-}"
if [ -z "$ghc_bin" ] && command -v wasm32-wasi-ghc > /dev/null 2>&1; then
  ghc_bin="$(dirname "$(command -v wasm32-wasi-ghc)")"
fi
if [ -z "$ghc_bin" ] && [ -n "${GHC_WASM_VERSION:-}" ] && command -v ghcup > /dev/null 2>&1; then
  prefix="$(ghcup whereis ghc "$GHC_WASM_VERSION" 2> /dev/null || true)"
  [ -n "$prefix" ] && ghc_bin="$prefix/bin"
fi

if [ -z "$ghc_bin" ] || [ ! -x "$ghc_bin/wasm32-wasi-ghc" ]; then
  echo "wasm: wasm32-wasi-ghc not found${ghc_bin:+ in $ghc_bin}" >&2
  echo "wasm: source ~/.ghc-wasm/env, or set GHC_WASM_VERSION / GHC_WASM_BIN" >&2
  exit 1
fi

# Upstream's wasm job also installs the wasm tools under their plain names.
# Cabal otherwise reaches for the *native* ghc and ghc-pkg, which then fail on
# wasm32-wasi targets. `--with-*` below is the documented way to do this; the
# symlinks are the belt-and-braces upstream needed.
ghcup_bin="/usr/local/.ghcup/bin"
if [ -d "$ghcup_bin" ]; then
  for tool in ghc ghc-pkg hsc2hs haddock; do
    link="$ghcup_bin/$tool"
    if [ -w "$ghcup_bin" ]; then
      ln -sf "$ghc_bin/wasm32-wasi-$tool" "$link"
    else
      sudo -n ln -sf "$ghc_bin/wasm32-wasi-$tool" "$link" 2> /dev/null || true
    fi
  done
  export PATH="$ghcup_bin:$PATH"
fi
export PATH="$ghc_bin:$PATH"

cabal_args=(
  --with-compiler="$ghc_bin/wasm32-wasi-ghc"
  --with-hc-pkg="$ghc_bin/wasm32-wasi-ghc-pkg"
  --with-hsc2hs="$ghc_bin/wasm32-wasi-hsc2hs"
  --with-haddock="$ghc_bin/wasm32-wasi-haddock"
)

cabal update
(
  cd "$source_dir"
  cabal "${cabal_args[@]}" build exe:hadolint
  cabal "${cabal_args[@]}" list-bin exe:hadolint
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
