---
"dlintr": minor
---

`hadolint.wasm` is now built and published by this repository rather than taken
from another project's committed blob, and it is built from hadolint v2.15.1
instead of a March 2025 snapshot.

- The new `WASM` workflow (`.github/workflows/wasm.yml`) builds the binary from
  the `vendor/hadolint` submodule, pinned to a release tag, and publishes it as
  an asset on the `hadolint-wasm` release. `scripts/hadolint-wasm.mjs` verifies
  the pinned SHA-256 of that asset, so the digest — not the URL — is still the
  pin. The binary is still not committed.
- It is smaller. The CLI is linked against the single-threaded RTS, which wasm
  needs anyway, and optimised with `wasm-opt -Oz --converge`: GHC's 22.34 MiB
  output becomes 7.78 MiB, or 1.65 MiB compressed.
- Seven rules that the old binary did not have are now reported: DL3062,
  DL3063, DL3064, DL3065, DL3066, DL3067 and DL3068, so expect new findings.
- CI builds the artifact once and hands it to the test matrix, so tests no
  longer depend on downloading a binary at all.
