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
- **`@bjorn3/browser_wasi_shim` is now a required dependency**, not an optional
  peer, and Node is no longer dependency-free. The built-in `node:wasi` cannot
  start a GHC reactor: `initialize` ends in `proc_exit(71)` and the RTS never
  starts. That is true of upstream's published reactor as well, so it is a
  `node:wasi` limitation rather than a defect here. Both runtimes now share one
  WASI implementation.
- The module ships with `ghc_wasm_jsffi.js`, GHC's half of the JSFFI. The
  exports are unreachable without it, so the release carries it too.
- It is smaller and more current: 7.9 MB against 12.4 MB, and seven rules the
  old binary did not have — DL3062 through DL3068 — so expect new findings.
