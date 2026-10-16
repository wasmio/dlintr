---
"dlintr": minor
---

**Breaking:** `run()` is gone, and `lint`/`getVersion` now call a WebAssembly
reactor instead of driving a command line. On 0.x the `minor` bump is the
breaking one — treat this as a major.

`hadolint.wasm` is also now built by this repository rather than taken from
another project's committed blob, and from hadolint v2.15.1 instead of a March
2025 snapshot.

- **`run()` disappears**, and with it the CLI surface. `--failure-threshold`,
  `--config`, `--format` and `--no-color` are no longer reachable from
  JavaScript; `lint` returns findings and the output format is fixed. Gate CI on
  `level` instead of an exit code.
- `ignore` and `severityOverrides` are unchanged in behaviour — applied to the
  returned findings, which is all they ever needed. `env` is unchanged too, and
  still reaches hadolint.
- It is smaller and more current: **7.55 MiB against 12.45 MiB**, and built from
  hadolint v2.15.1 rather than a March 2025 snapshot — its rule set now runs to
  **DL3067**, so expect findings the old binary could not report.
- If you copy the module out of the package, copy `ghc_wasm_jsffi.js` beside it:
  the exports are unreachable without it, so the tarball carries both.
