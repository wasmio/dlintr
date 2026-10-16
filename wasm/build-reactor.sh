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

for tool in wasm32-wasi-cabal wasm32-wasi-ghc wasm-opt; do
  command -v "$tool" > /dev/null || {
    echo "wasm: $tool not found on PATH — did you 'source ~/.ghc-wasm/env'?" >&2
    exit 1
  }
done

(
  cd "$project"
  wasm32-wasi-cabal build exe:hadolint-wasi
  wasm32-wasi-cabal list-bin exe:hadolint-wasi
) | tee /tmp/wasm-reactor-bin.txt >&2
bin="$(tail -n 1 /tmp/wasm-reactor-bin.txt)"

wasm-opt -Oz --converge -o "$output" "$bin"

# The module exports `lint` and `version` into JS, but only through GHC's glue:
# it is the JS side that knows how to marshal a JSString in and out and how to
# drive the RTS. Ship it next to the module or the exports are uncallable.
"$(wasm32-wasi-ghc --print-libdir)/post-link.mjs" -i "$output" -o "$glue"

echo "wasm: wrote $output and $glue"
sha256sum "$output"
