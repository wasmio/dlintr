# Change Log

## 0.3.0

### Minor Changes

- [#42](https://github.com/wasmio/dlintr/pull/42) [`0742b50`](https://github.com/wasmio/dlintr/commit/0742b50da43bb889ac68e69ab318e6de08cf4503) Thanks [@JounQin](https://github.com/JounQin)! - The `env` option is gone; the configuration it carried is typed instead.

  `LintOptions` now has `trustedRegistries`, `requireLabels`, `strictLabels` and `disableIgnorePragma`. On Node each one is also read from the matching `HADOLINT_*` variable in `process.env` when the option is absent, so a process can be configured once; an explicit option wins over the variable.

  ```js
  // before
  lint(text, { env: { HADOLINT_TRUSTED_REGISTRIES: 'docker.io' } })

  // after
  lint(text, { trustedRegistries: ['docker.io'] })
  ```

  `requireLabels` takes `{ label: type }`, where the type is one of `email`, `hash`, `rfc3339`, `semver`, `spdx`, `text`, `url` — hadolint spells the raw-text one `text`, not `string`.

  An explicit empty list removes the setting: `trustedRegistries: []` means "no restriction" and also clears an inherited `HADOLINT_TRUSTED_REGISTRIES`, rather than writing an empty value that hadolint would read as a single unusable entry.

## 0.2.0

### Minor Changes

- [#30](https://github.com/wasmio/dlintr/pull/30) [`7ebc2c0`](https://github.com/wasmio/dlintr/commit/7ebc2c0856434cafcb96392e317d14a567294c75) Thanks [@JounQin](https://github.com/JounQin)! - **Breaking:** `run()` is gone, and `lint`/`getVersion` now call a WebAssembly
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

## 0.1.1

### Patch Changes

- [#27](https://github.com/wasmio/dlintr/pull/27) [`13c6275`](https://github.com/wasmio/dlintr/commit/13c6275bf6edec7b92d634cce4230966b05b0de5) Thanks [@JounQin](https://github.com/JounQin)! - Release with provenance

  Published tarballs carry a provenance attestation naming the repository, commit
  and workflow they were built from. The publish step now states
  `provenance: true` rather than leaving it to trusted publishing's default.

## 0.1.0

### Minor Changes

- [#25](https://github.com/wasmio/dlintr/pull/25) [`2770f8d`](https://github.com/wasmio/dlintr/commit/2770f8d961af0cd7ae9cd70b60bd13b83de83404) Thanks [@JounQin](https://github.com/JounQin)! - Implement the actual Dockerfile linter

  `dlintr` was a placeholder exporting `echo()`. It now lints Dockerfiles by running
  [`hadolint`](https://github.com/hadolint/hadolint) — compiled to WASI with the GHC
  backend — in-process:

  ```js
  import { lint } from 'dlintr'

  await lint('FROM ubuntu:latest\nRUN apt-get update\n')
  // [{ code: 'DL3007', line: 1, level: 'warning', … }, { code: 'DL3009', line: 2, … }]
  ```

  - Node runs the module through the built-in `node:wasi`, so Node users install
    nothing extra. Browsers go through the `browser` export condition onto
    `@bjorn3/browser_wasi_shim` (~29 kB minified), an optional peer dependency.
  - The Dockerfile is passed over stdin, so no filesystem is mounted and the linter
    can only ever see what it was handed.
  - `lint` reports an unparseable Dockerfile as a `DL1000` finding, and throws
    rather than returning "no findings" when hadolint rejects an option.

  The wasm binary is a build artifact: `scripts/hadolint-wasm.mjs` fetches it from a
  pinned `wasilibs/go-hadolint` commit, verifies its SHA-256, and is not committed.

  **Breaking:** requires Node.js 20.1+ for `node:wasi`, and the `echo` default
  export is gone.
