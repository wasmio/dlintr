#!/usr/bin/env bash
#
# Builds the JS-facing *reactor* — `lint` and `version` as callable exports —
# from the local `hadolint-wasi` package, which depends on the `hadolint`
# submodule.
#
# This is the counterpart to `wasm/build.sh`, which builds the WASI /command/.
# Both exist on purpose: the command is the pipeline's known-good smoke test,
# and the reactor is what the runtime will actually call. The command path goes
# away once the reactor is verified.
#
# Produces two files:
#   hadolint.wasm     the reactor module
#   ghc_wasm_jsffi.js GHC's JS half of the JSFFI, without which the exports
#                     cannot be called at all
#
# CI builds this on every run, and the byte-equality test exercises the result.
#
# Usage: wasm/build-reactor.sh [output.wasm] [ghc_wasm_jsffi.js]
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
project="$root/wasm/hadolint-wasi"
output="${1:-$root/hadolint.wasm}"
glue="${2:-$root/ghc_wasm_jsffi.js}"

if [ ! -f "$root/hadolint/hadolint.cabal" ]; then
  echo "wasm: hadolint/ is empty — run 'git submodule update --init'" >&2
  exit 1
fi

# The toolchain puts `wasm32-wasi-*`, cabal and the pinned `wasm-opt` on PATH,
# and `wasm/toolchain.sh` writes that as `$PREFIX/wasm-env`. Sourcing it here
# means calling this script is enough: a PATH the caller has to set is a step
# that can be forgotten, and forgetting it produces a message about a missing
# tool rather than about the missing step.
prefix="${PREFIX:-$HOME/.ghc-wasm}"
if [ -f "$prefix/wasm-env" ]; then
  # shellcheck disable=SC1091
  source "$prefix/wasm-env"
fi

for tool in wasm32-wasi-cabal wasm32-wasi-ghc wasm-opt; do
  command -v "$tool" > /dev/null || {
    echo "wasm: $tool not found on PATH — install the toolchain with wasm/toolchain.sh" >&2
    exit 1
  }
done

# The build prints the path it produced as its last line, so it has to be teed
# somewhere. `mktemp` rather than a fixed `/tmp/...` name: on WSL2 that directory
# is a small tmpfs, and a fixed name is one more thing that only works when one
# build runs at a time.
list="$(mktemp)"
(
  cd "$project"
  wasm32-wasi-cabal build exe:hadolint-wasi
  wasm32-wasi-cabal list-bin exe:hadolint-wasi
) | tee "$list" >&2
bin="$(tail -n 1 "$list")"
rm -f "$list"

wasm-opt -Oz --converge -o "$output" "$bin"

# The module exports `lint` and `version` into JS, but only through GHC's glue:
# it is the JS side that knows how to marshal a JSString in and out and how to
# drive the RTS. Ship it next to the module or the exports are uncallable.
"$(wasm32-wasi-ghc --print-libdir)/post-link.mjs" -i "$output" -o "$glue"

echo "wasm: wrote $output and $glue"
sha256sum "$output"
