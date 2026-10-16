#!/usr/bin/env bash
#
# Installs the pinned GHC wasm toolchain.
#
# This script is the one place the toolchain's versions are pinned, and it is
# the same script on every host: run directly on Linux and macOS, and run inside
# WSL2 on Windows, where the Windows workflows call it. ghc-wasm-meta ships no
# Windows bindist at all — its `setup.sh` branches on Linux and macOS only — so
# WSL is not a convenience there, it is the only way to have a toolchain.
#
# It is deliberately not a workflow step: `wasm.yml` used to hold this logic
# inline, which meant the pins, the cache key and the PATH juggling lived in YAML
# that could only be exercised by pushing. Everything here runs, and can be
# debugged, on a developer's machine.
#
# Needs: curl, git, tar, jq, make, unzip, xz, zstd. A missing one is named and
# exits non-zero; it does not fall through to a build that will fail later.
#
# Sets up, under $PREFIX (default ~/.ghc-wasm):
#   env       written by ghc-wasm-meta's setup.sh
#   wasm-env  the file to source; adds the pinned binaryen to PATH
#
set -euo pipefail

# --- pins -------------------------------------------------------------------

# `setup.sh` names the whole toolchain — GHC bindist, wasi-sdk, cabal, binaryen,
# wasmtime — in `autogen.json` of whichever ghc-wasm-meta revision it runs from,
# so a full commit hash pins all of it at once and makes that file immutable.
GHC_WASM_META_REV=60098a5076557e327b326a1a3ba3b5fb4fec1e49
GHC_WASM_BINDIST_TAG=20260403T135157
GHC_WASM_BINDIST_SHA256=60d0e537548a82590fd6cfd6eaec5ceba0bc58bf320a6f491843a1cf4403bce8

# `FLAVOUR=9.10` is load-bearing: the default is 9.14, and hadolint needs
# `ghc-experimental >=9.1003 && <9.1201`, which 9.14 cannot satisfy.
#
# Equally load-bearing: `setup.sh` must run *without* `SKIP_GHC`. The bindist
# ships unconfigured, and it is `setup.sh`'s own `./configure --target=wasm32-wasi`
# that turns it into a wasm compiler. Skip that and you get a GHC which reports a
# wasm target while emitting x86-64 assembly, which the wasm assembler rejects
# with "Wasm doesn't support data symbols in text sections" (`@progbits`).
FLAVOUR=9.10

# `setup.sh` installs a binaryen of its own from the same `autogen.json` — 129 at
# this revision. `wasm-opt` decides the bytes of the artifact, so the optimiser
# is pinned here separately and put first on PATH.
BINARYEN_VERSION=version_133

# One asset per supported host, with the digest GitHub computed at upload. The
# host this runs on is not always the host that was tested last: the build now
# runs on macOS and on Windows-inside-WSL as well as on Linux, so a single
# hardcoded x86_64-linux tarball is not enough. An unsupported host fails here
# rather than several minutes into a compile.
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64)
    BINARYEN_ASSET=binaryen-version_133-x86_64-linux.tar.gz
    BINARYEN_SHA256=2dc9c7813f5375db93d96ead4b78222fcc3e2677bbb832297af4797782a37489
    ;;
  Linux-aarch64)
    BINARYEN_ASSET=binaryen-version_133-aarch64-linux.tar.gz
    BINARYEN_SHA256=89c07ea56faf38d0fbecf36ca8ec0721756716185f265b568e133d427f299bf8
    ;;
  Darwin-arm64)
    BINARYEN_ASSET=binaryen-version_133-arm64-macos.tar.gz
    BINARYEN_SHA256=ad66da82ac13f163e424b1643f16c6dfcccc98b5966296b43e52d3cab04f84a8
    ;;
  Darwin-x86_64)
    BINARYEN_ASSET=binaryen-version_133-x86_64-macos.tar.gz
    BINARYEN_SHA256=13a9b90be775c6389ce3d1f879cb8627bea56708ba8c122983941d53a8199b95
    ;;
  *)
    echo "wasm: no pinned binaryen for $(uname -s)-$(uname -m)" >&2
    exit 1
    ;;
esac

PREFIX="${PREFIX:-$HOME/.ghc-wasm}"

# `setup.sh` stages its downloads *and* the extracted GHC tree in a
# `$(mktemp -d)`. On WSL2 `/tmp` is a 3.9 GB tmpfs, which is smaller than that
# install, and the extraction dies part way through with
#
#   tar: wrappers/wasm32-wasi-hp2ps-ghc-...: Cannot write: No space left on device
#
# which reads like a disk limit and is not one — WSL2's own ext4 has room, and
# the 8 GB the toolchain needs is available on the Windows drive. Pointing
# TMPDIR at a disk-backed directory is the whole fix, and it is harmless on
# Linux and macOS, so it is unconditional rather than WSL-specific.
mkdir -p "$HOME/tmp"
export TMPDIR="$HOME/tmp"

# --- preconditions ----------------------------------------------------------

missing=()
for tool in curl git tar jq make unzip xz zstd; do
  command -v "$tool" > /dev/null || missing+=("$tool")
done

if [ ${#missing[@]} -gt 0 ]; then
  echo "wasm: missing host tools: ${missing[*]}" >&2
  echo "wasm: Debian/Ubuntu: apt-get install -y curl git tar jq make unzip xz-utils zstd" >&2
  echo "wasm: macOS:         brew install jq make xz zstd gnu-tar" >&2
  exit 1
fi

digest_of() {
  if command -v sha256sum > /dev/null; then
    sha256sum "$1" | cut -d' ' -f1
  else
    # macOS ships shasum, not sha256sum.
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

# A replaced release asset must fail here rather than quietly become the
# compiler we build with. `setup.sh` fetches the bindist into a workdir it
# deletes, so the tarball cannot be hashed afterwards; GitHub's own digest for
# the asset is checked before installing instead.
#
# The API is used with a token when one is in the environment, because the
# anonymous allowance is per IP and the Windows legs reach it from inside WSL.
# Without a token this still works, it is just subject to that limit — and a
# failure to ask is fatal rather than skipped, since the whole point is the
# check.
api_auth=()
if [ -n "${GH_TOKEN:-}" ]; then
  api_auth=(-H "Authorization: Bearer $GH_TOKEN")
elif [ -n "${GITHUB_TOKEN:-}" ]; then
  api_auth=(-H "Authorization: Bearer $GITHUB_TOKEN")
fi

echo "wasm: checking the $GHC_WASM_BINDIST_TAG bindist digest"
bindist_url="https://api.github.com/repos/haskell-wasm/ghc-wasm-bindists/releases/tags/$GHC_WASM_BINDIST_TAG"
published="$(curl -fsSL ${api_auth[@]+"${api_auth[@]}"} "$bindist_url" \
  | jq -r '.assets[] | select(.name == "wasm32-wasi-ghc-9.10.tar.xz") | .digest')"
if [ "sha256:$GHC_WASM_BINDIST_SHA256" != "$published" ]; then
  echo "wasm: bindist digest is '$published', expected 'sha256:$GHC_WASM_BINDIST_SHA256'" >&2
  exit 1
fi

# --- the toolchain ----------------------------------------------------------

echo "wasm: installing ghc-wasm-meta@$GHC_WASM_META_REV"
meta="$TMPDIR/ghc-wasm-meta"
rm -rf "$meta"
git clone --quiet https://gitlab.haskell.org/haskell-wasm/ghc-wasm-meta.git "$meta"
git -C "$meta" checkout --quiet "$GHC_WASM_META_REV"

FLAVOUR="$FLAVOUR" PREFIX="$PREFIX" bash "$meta/setup.sh"

# --- the pinned optimiser ---------------------------------------------------

echo "wasm: installing binaryen $BINARYEN_VERSION ($BINARYEN_ASSET)"
binaryen="$TMPDIR/$BINARYEN_ASSET"
curl -fsSL -o "$binaryen" \
  "https://github.com/WebAssembly/binaryen/releases/download/$BINARYEN_VERSION/$BINARYEN_ASSET"

actual="$(digest_of "$binaryen")"
if [ "$BINARYEN_SHA256" != "$actual" ]; then
  echo "wasm: binaryen digest is '$actual', expected '$BINARYEN_SHA256'" >&2
  exit 1
fi

rm -rf "$PREFIX/binaryen-$BINARYEN_VERSION"
tar xzf "$binaryen" -C "$PREFIX"

# One file to source, so the build and the workflows cannot disagree about what
# "the toolchain" is. `setup.sh` writes `$PREFIX/env` itself; this adds ours.
cat > "$PREFIX/wasm-env" << ENV
source "$PREFIX/env"
export PATH="$PREFIX/binaryen-$BINARYEN_VERSION/bin:\$PATH"
ENV

# --- prove it works ---------------------------------------------------------
#
# Deliberately here and not skipped: if the pinned toolchain cannot compile a
# one-line program then it cannot compile any Haskell, and the fault is the
# toolchain rather than anything in this repository. Running the module, not just
# building it, is what makes a missing wasmtime or a broken RTS visible now
# instead of as a mysterious failure in a later step.
#
# shellcheck disable=SC1091
source "$PREFIX/wasm-env"

echo "wasm32-wasi-ghc: $(wasm32-wasi-ghc --version)"
echo "wasm-opt:        $(wasm-opt --version)"

case "$(wasm-opt --version)" in
  *"version ${BINARYEN_VERSION#version_}"*) ;;
  *)
    echo "wasm: expected the pinned wasm-opt, got: $(wasm-opt --version)" >&2
    exit 1
    ;;
esac

probe="$(mktemp -d)"
printf 'main = putStrLn "hi"\n' > "$probe/hello.hs"
wasm32-wasi-ghc "$probe/hello.hs" -o "$probe/hello.wasm"
says="$(wasmtime "$probe/hello.wasm")"
rm -rf "$probe"

if [ "$says" != "hi" ]; then
  echo "wasm: the toolchain built a module that printed '$says', expected 'hi'" >&2
  exit 1
fi

echo "wasm: toolchain ready — hello world compiled and ran"
echo "wasm: now run:  source $PREFIX/wasm-env"
