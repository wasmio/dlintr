# dlintr

[![GitHub Actions](https://github.com/wasmio/dlintr/workflows/CI/badge.svg)](https://github.com/wasmio/dlintr/actions/workflows/ci.yml)
[![Codecov](https://img.shields.io/codecov/c/github/wasmio/dlintr.svg)](https://codecov.io/gh/wasmio/dlintr)
[![Language grade: JavaScript](https://img.shields.io/lgtm/grade/javascript/g/wasmio/dlintr.svg?logo=lgtm&logoWidth=18)](https://lgtm.com/projects/g/wasmio/dlintr/context:javascript)
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

Requires Node.js 20.1+ for the built-in [`node:wasi`][node-wasi].

### API

```js
import { getVersion, lint, run } from 'dlintr'

// Lint Dockerfile content and get the findings back.
const results = await lint('FROM ubuntu:latest\nRUN apt-get update\n')
// [
//   { code: 'DL3007', line: 1, column: 1, level: 'warning', file: '-', message: '…' },
//   { code: 'DL3009', line: 2, column: 1, level: 'info', file: '-', message: '…' },
// ]

await lint('FROM alpine:3.20\n', {
  ignore: ['DL3009'], // rule codes to suppress
  severityOverrides: { DL3007: 'error' }, // re-level a single rule
  env: { HADOLINT_TRUSTED_REGISTRIES: 'docker.io' }, // anything hadolint reads
})

await getVersion() // 'Haskell Dockerfile Linter 3.0.0'

// Or drive the CLI directly, for options `lint` does not model.
const { exitCode, stdout, stderr } = await run(
  ['--no-color', '--failure-threshold', 'error', '-'],
  {
    stdin: 'FROM ubuntu:latest\n',
  },
)
```

An unparseable Dockerfile is reported, not thrown: hadolint returns it as a `DL1000` finding with `level: 'error'`. Anything that stops hadolint before linting — a rejected option, for instance — is thrown, since it would otherwise be indistinguishable from a clean Dockerfile.

`lint` returns findings and drops the exit code. To gate CI, either look at `level`, or use `run` with `--failure-threshold` and check `exitCode`.

### How it works

[`hadolint`][hadolint] is compiled to WASI with the GHC backend and executed in-process; there is no native binary and no Docker.

- **Node** drives it with the built-in `node:wasi`, so there is nothing to install.
- **Browsers** get [`@bjorn3/browser_wasi_shim`][bjorn3] (~29 kB minified) through the `browser` export condition. It is an optional peer dependency — install it if you target the browser, and Node users never pay for it.

The Dockerfile is fed over stdin, which is why no filesystem has to be mounted: only what you pass to `lint`/`run` is ever visible to the linter, and it cannot read files from the host.

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
