# dlintr

[![GitHub Actions](https://github.com/wasmio/dlintr/workflows/CI/badge.svg)](https://github.com/wasmio/dlintr/actions/workflows/ci.yml)
[![Codecov](https://img.shields.io/codecov/c/github/wasmio/dlintr.svg)](https://codecov.io/gh/wasmio/dlintr)
[![type-coverage](https://img.shields.io/badge/dynamic/json.svg?label=type-coverage&prefix=%E2%89%A5&suffix=%&query=$.typeCoverage.atLeast&uri=https%3A%2F%2Fraw.githubusercontent.com%2Fwasmio%2Fdlintr%2Fmain%2Fpackage.json)](https://github.com/plantain-00/type-coverage)
[![npm](https://img.shields.io/npm/v/dlintr.svg)](https://www.npmjs.com/package/dlintr)
[![GitHub Release](https://img.shields.io/github/release/wasmio/dlintr)](https://github.com/wasmio/dlintr/releases)

[![Conventional Commits](https://img.shields.io/badge/conventional%20commits-1.0.0-yellow.svg)](https://conventionalcommits.org)
[![Renovate enabled](https://img.shields.io/badge/renovate-enabled-brightgreen.svg)](https://renovatebot.com)
[![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)
[![Code Style: Prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg)](https://github.com/prettier/prettier)
[![changesets](https://img.shields.io/badge/maintained%20with-changesets-176de3.svg)](https://github.com/changesets/changesets)

Dockerfile linter, validate inline bash, powered by [`hadolint`](https://github.com/hadolint/hadolint) with WASM

## TOC <!-- omit in toc -->

- [Usage](#usage)
  - [Install](#install)
  - [API](#api)
  - [How it works](#how-it-works)
- [Sponsors](#sponsors)
- [Backers](#backers)
- [Changelog](#changelog)
- [License](#license)

## Usage

### Install

```sh
# pnpm
pnpm add dlintr

# yarn
yarn add dlintr

# npm
npm i dlintr
```

No runtime dependencies: the WASI surface hadolint needs is implemented in
`src/wasi.ts`.

### API

```js
import { getVersion, lint } from 'dlintr'

// Lint Dockerfile content and get the findings back.
const results = await lint('FROM ubuntu:latest\nRUN apt-get update\n')
// [
//   { code: 'DL3007', line: 1, column: 1, level: 'warning', file: '-', message: '…' },
//   { code: 'DL3009', line: 2, column: 1, level: 'info', file: '-', message: '…' },
// ]

await lint('FROM alpine:3.20\n', {
  ignore: ['DL3009'], // rule codes to suppress, applied to the findings
  severityOverrides: { DL3007: 'error' }, // re-level a single rule
  env: { HADOLINT_TRUSTED_REGISTRIES: 'docker.io' }, // anything hadolint reads
})

await getVersion() // 'Haskell Dockerfile Linter 2.15.1'
```

An unparseable Dockerfile is reported, not thrown: hadolint returns it as a
`DL1000` finding with `level: 'error'`.

To gate CI, look at `level`:

```js
const problems = (await lint(dockerfile)).filter(
  ({ level }) => level === 'error',
)
```

### How it works

[`hadolint`][hadolint] is compiled to a WebAssembly _reactor_ with the GHC
backend and called in-process; there is no native binary and no Docker. The
module is instantiated once and `lint` is called on it.

**This is a breaking change from 0.1.x.** The module previously exposed
hadolint's command-line interface, and now exports one function:

- **`run()` is gone**, and with it the whole CLI surface. `--failure-threshold`,
  `--config`, `--format`, `--no-color` and the rest are no longer reachable
  from JavaScript. `lint` returns the findings as JSON, and the output format is
  no longer configurable.
- `ignore` and `severityOverrides` survive, applied to the returned findings —
  they only ever filtered and relabelled, so they never needed the Haskell side.
- `env` survives too, and reaches hadolint through WASI as before.
- **`node:wasi` cannot host this module at all.** Its `initialize` ends in
  `proc_exit(71)` and the RTS never starts, so every call answers "RTS is not
  initialised". That is true of upstream's published reactor as well, so it is a
  limitation of `node:wasi` rather than of this build. Node and the browser
  therefore share one WASI implementation, from `src/wasi.ts`.

Nothing is fed over stdin any more: the Dockerfile is passed straight to `lint`,
so the module never sees a file descriptor that could read the host.

### The WASI surface, and its residual risk

hadolint needs five WASI calls — `args_get`, `args_sizes_get`, `environ_get`,
`environ_sizes_get` and `clock_time_get` — and never touches the other fifteen
it declares, including all of `fd_*`, `path_*` and `proc_exit`. That is
**measured, not assumed**: `node wasm/calls.mjs` instruments every import and
reports what is actually called on each path. Run it when the hadolint submodule
or the wasm recipe moves.

`src/wasi.ts` implements those five and makes the rest **throw by name**, so a
module that reaches further fails at `fd_write` with an explanation rather than
silently losing output.

Two things follow, stated plainly:

- **The implemented surface is version-bound.** It is correct for the build that
  was measured. That is exactly why the unimplemented imports throw rather than
  doing nothing, and why `wasm/calls.mjs` is committed.
- **This is not a tested third-party WASI implementation.** The stubs protect the
  paths the test suite exercises. A path it does not exercise could reach an
  unimplemented import in your hands, and the failure there is an exception
  rather than a wrong answer — better than silent corruption, but not the same
  guarantee a maintained WASI library gives.

### Why the build is checked for drift

The wasm is built by this repository, and identical inputs are _expected_ to
produce identical bytes. Usually they do. Occasionally they do not, and that is
worth stopping for: either something under `wasm/` changed without the recipe
hash moving, or the toolchain produced a different binary from the same source.

`wasm/digests.json` records a digest per (submodule revision, recipe hash), and
`wasm.yml` fails when a build disagrees with the recorded value, before
anything is attested or uploaded. The message names both digests and the two
ways forward.

This is a **drift check**, justified on its own terms: a build that differs for
identical inputs is either nondeterminism worth knowing about or corruption.
A divergent build is _also_ the only one so far observed to crash a test runner
on Windows, but that rests on a single sample — **the check is not claimed to
catch that, and it will not be until the correlation is actually shown.**

The recorded value is not a reproducibility guarantee. It is the digest this
combination produced the last time anyone looked.

## Sponsors

| 1stG                                                                                                                               | RxTS                                                                                                                               | UnTS                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| [![1stG Open Collective backers and sponsors](https://opencollective.com/1stG/organizations.svg)](https://opencollective.com/1stG) | [![RxTS Open Collective backers and sponsors](https://opencollective.com/rxts/organizations.svg)](https://opencollective.com/rxts) | [![UnTS Open Collective backers and sponsors](https://opencollective.com/unts/organizations.svg)](https://opencollective.com/unts) |

## Backers

[![Backers](https://raw.githubusercontent.com/1stG/static/master/sponsors.svg)](https://github.com/sponsors/JounQin)

| 1stG                                                                                                                             | RxTS                                                                                                                             | UnTS                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| [![1stG Open Collective backers and sponsors](https://opencollective.com/1stG/individuals.svg)](https://opencollective.com/1stG) | [![RxTS Open Collective backers and sponsors](https://opencollective.com/rxts/individuals.svg)](https://opencollective.com/rxts) | [![UnTS Open Collective backers and sponsors](https://opencollective.com/unts/individuals.svg)](https://opencollective.com/unts) |

## Changelog

Detailed changes for each release are documented in [CHANGELOG.md](./CHANGELOG.md).

## License

[MIT][] © [JounQin][]@[1stG.me][]

[1stg.me]: https://www.1stg.me
[bjorn3]: https://github.com/bjorn3/browser_wasi_shim
[hadolint]: https://github.com/hadolint/hadolint
[jounqin]: https://GitHub.com/JounQin
[mit]: http://opensource.org/licenses/MIT
[node-wasi]: https://nodejs.org/api/wasi.html
