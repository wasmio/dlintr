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
  still reaches hadolint through WASI.
- **`node:wasi` cannot host this module**, so an earlier draft of this release
  took on `@bjorn3/browser_wasi_shim` to compensate. It does not: the WASI
  surface hadolint actually calls is five functions, measured rather than
  assumed (`node wasm/calls.mjs`), and `src/wasi.ts` implements them. The
  package keeps **no runtime dependencies**, and the fifteen imports it never
  calls throw by name if a future module reaches for them.
- The module ships with `ghc_wasm_jsffi.js`, GHC's half of the JSFFI. The
  exports are unreachable without it, so the npm tarball carries both.
- It is smaller and more current: 7.9 MB against 12.4 MB, and seven rules the
  old binary did not have — DL3062 through DL3068 — so expect new findings.
