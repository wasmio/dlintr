---
"dlintr": minor
---

`hadolint.wasm` is now built by this repository rather than taken from another
project's committed blob, and it is built from hadolint v2.15.1 instead of a
March 2025 snapshot.

- The new `WASM` workflow (`.github/workflows/wasm.yml`) builds the binary from
  the `hadolint` submodule, pinned to a release tag. `release.yml` attaches it
  to the release the normal changesets flow creates, and
  `scripts/hadolint-wasm.mjs` fetches it back for the version of the package it
  belongs to. The binary is still not committed.
- It is smaller. The CLI is linked against the single-threaded RTS, which wasm
  needs anyway, and optimised with `wasm-opt -Oz --converge`: measured on the
  same source, GHC's 22.34 MiB output becomes 8.71 MiB, against 12.45 MiB for
  the binary that shipped before.
- Seven rules that the old binary did not have are now reported: DL3062,
  DL3063, DL3064, DL3065, DL3066, DL3067 and DL3068, so expect new findings.
- CI builds the artifact once and hands it to the test matrix, so tests no
  longer depend on downloading a binary at all.
