# The wasm32-wasi backend is not reproducible

**Filed** as <https://github.com/haskell-wasm/ghc-wasm-bindists/issues/49>. It
went there rather than to `gitlab.haskell.org` because that instance flags newly
registered accounts as _external_, and an external user cannot create issues
anywhere on it. The text below is what was filed.

Note for anyone reproducing it now: the build was driven by
`.github/workflows/wasm.yml` at the time, and that workflow has since been
replaced by `.github/actions/wasm-toolchain` and `wasm/toolchain.sh`. The recipe
is unchanged; only the file holding it moved.

---

## Summary

The GHC wasm backend produces **different binaries from identical inputs**. Two
builds of the same source, the same pinned toolchain, the same dependency
versions and no build cache between them produced modules of the same size whose
sha256 differs. Eight distinct digests are on record for one pinned revision of
the program being built.

`wasm-opt` is ruled out by measurement. The divergence is present in the linked
module.

## Environment

|                          |                                                                    |
| ------------------------ | ------------------------------------------------------------------ |
| GHC                      | 9.10.3, `wasm32-wasi`, via `ghc-wasm-meta`                         |
| `ghc-wasm-meta` revision | `60098a5076557e327b326a1a3ba3b5fb4fec1e49`                         |
| bindist tag              | `20260403T135157`                                                  |
| bindist sha256           | `60d0e537548a82590fd6cfd6eaec5ceba0bc58bf320a6f491843a1cf4403bce8` |
| `wasm-opt`               | binaryen 133, `-Oz --converge`                                     |
| host                     | GitHub Actions `ubuntu-latest`, x86-64                             |
| program                  | hadolint v2.15.1 (`exe:hadolint` linked as a reactor)              |
| runner                   | Node.js 24.21.0 (`node:wasi`)                                      |

Boot packages are the ones shipped with this bindist: `base-4.20.2.0`,
`text-2.1.3`, `bytestring-0.12.2.0`, `containers-0.7`.

## Build

```
source ~/.ghc-wasm/env
wasm32-wasi-cabal build exe:hadolint-wasi
wasm-opt -Oz --converge <input> -o hadolint.wasm
```

The link uses `-no-hs-main -optl-mexec-model=reactor -optl-Wl,--export=lint
-optl-Wl,--export=version -single-threaded "-with-rtsopts=-A4m"`.

## Observation

Two runs, **build cache deleted before each** so neither could restore anything.
The toolchain cache was warm for both — it is a fixed input and not the variable
under test. Both runs report the cache state in their own log:

```
Cache restored from key: wasm-toolchain-Linux-60098a5076557e327b326a1a3ba3b5fb4fec1e49-20260403T135157-2dc9c7813f5375db93d96ead4b78222fcc3e2677bbb832297af4797782a37489
Cache not found for input keys: wasm-build-Linux-2eece55955ced00200be9729e9728cb7dacca505-87540769fcfd51ae1f0d815e54fed21fdf380049a87831680e1e9ab5c08abb24
```

Results, same commit, same recipe:

```
build 1  459d4d45a3497b2786f828f65628d501746acd48441b2a057649344d573fdddc
build 2  ce9027d2abc9b9f6fc6717d2a511d9ad64af4ee65cb15fc2621bff5eeb16efcd
```

**Eight digests on record for submodule revision
`2eece55955ced00200be9729e9728cb7dacca505`** (hadolint v2.15.1), across a small
number of recipe permutations — the recipe changed only in build-script comments
and workflow structure between them, never in a way that alters the module:

```
31ec59d886ba9fd95aec2add11478816d030dcdba96fd7bf016521d70e65e9a0
fce4721f…  (prefix only; see note)
ffd4f05799be9536c5fea0b65f052aeefc026fd85b2ef201a1fa8e986f648b1a
db640e3c5bf39d078c7d4d3f8a943fb78507d624817298fed47f9b53338150cd
445695d3b9e40d2bfef461f4554646fd99654f0c7eccd953ea2d174316c22c9b
7dff15ed3e4dc2812aa967de98deb1463840ea026d0afc7f0600e26096f017f4
459d4d45a3497b2786f828f65628d501746acd48441b2a057649344d573fdddc
ce9027d2abc9b9f6fc6717d2a511d9ad64af4ee65cb15fc2621bff5eeb16efcd
```

(Seven full values and one prefix. `fce4721f…` predates the step that echoes the
digest to the log, so only its prefix was captured; it is listed because the
count is the point, and no claim here rests on it.)

Artifact sizes differ by a byte or two between builds while the code section
diverges substantially — a common prefix of roughly 92 KB and a common suffix of
roughly 350 bytes in the one pair that was measured in detail.

## `wasm-opt` is ruled out

Taking one linked module and running `wasm-opt -Oz --converge` twice gives
**byte-identical output**. Taking the same module through `-O0` and back gives
the same bytes as well. The nondeterminism is therefore upstream of the optimiser,
in what GHC emits or in how `wasm-ld` lays it out.

## What is not the cause

- **Not the build cache.** Both builds above were cold, with the cache miss quoted
  from the log. An earlier suspicion that a warm cache and a cold cache produce
  different modules was tested and is not needed to explain this: two cold builds
  already disagree.
- **Not dependency versions.** Both runs resolved the same versions from the same
  index state (`text-2.1.3`, `ShellCheck-0.11.0`, `aeson-2.2.5.1`,
  `language-docker-16.0.0`, `megaparsec-9.7.1`, `optparse-applicative-0.19.0.0`,
  `HsYAML-0.2.1.6`).

## Why it matters

A dependency-vendoring pipeline wants to pin an artifact by digest. That is not
possible when identical inputs yield different bytes: a recorded digest cannot be
compared against a rebuild, and no release can claim that a rebuild reproduces
what was published. We retired the check rather than leave it failing.

## Reproduction

The build is driven by `.github/workflows/wasm.yml` in
`https://github.com/wasmio/dlintr` (`feat/wasm-ci-build`). Delete the
`wasm-build-*` cache entries, run the workflow twice, and compare
`hadolint.wasm.sha256` from each run. `wasm/digests.json` holds the accumulated
observations and `wasm/check-digest.mjs` reads them.

Happy to run further experiments — bisecting the link flags, comparing
`wasm-ld` output before optimisation, or reducing to a minimal module — if that
would help localise it. Which of `wasm-ld` and the backend is responsible is not
something the two-build experiment distinguishes.
