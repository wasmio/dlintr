# Change Log

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
