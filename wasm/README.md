# `hadolint.wasm`

The WASI build of [hadolint](https://github.com/hadolint/hadolint) this package
ships. It is a build artifact, so it is produced by
`.github/workflows/wasm.yml` and never committed — it is gitignored, and it is
the only thing in the published package that is not source.

## Where the binary comes from

There is one source, and it is this repository:

1. `wasm/build-reactor.sh` builds the **reactor** the runtime calls, out of the
   `hadolint` submodule (pinned to a release tag): `hadolint.wasm` plus
   `ghc_wasm_jsffi.js`, GHC's half of the JSFFI. Both are needed — the exports
   are unreachable without the glue.
   `wasm/build.sh` builds the CLI (`exe:hadolint`) as a WASI _command_ instead.
   That is kept as the reference the byte-equality test compares against, and is
   **not** what the runtime loads: `createReactor` rejects a command module.
2. The `WASM` workflow runs both, smoke-tests the command, and uploads them as
   two artifacts: `hadolint-wasm` (the reactor and its glue) and `hadolint-cli`
   (the command, for the test). Every job that needs a binary downloads the
   artifact rather than building another one, which is why building it is
   deliberately not part of `pnpm build`.
3. `pnpm build:wasm` runs `wasm/build-reactor.sh` for a local checkout. Nothing
   fetches a binary from anywhere, and nothing is attached to a release.

### Why not upstream's own wasm build

hadolint does compile to wasm, and publishes the result to its website. That
module is a JSFFI _reactor_: its `setup` and `lint` exports read from the site's
DOM (`#lint`, `#dockerfile__code`, `#version`), it has no `_start`, and it is
deployed as a GitHub Pages site rather than a versioned, checksummed asset.
This package needs the opposite: a WASI _reactor_ — imports
`wasi_snapshot_preview1`, exports `_initialize`, `lint` and `version`, and no
`_start`. That is what `src/wasi.ts` hosts, and `createReactor` refuses a
command module by name.

Upstream also marks `exe:hadolint` as `buildable: False` on wasm32 and passes it
`-threaded`, which wasm32-wasi cannot link.
`wasm/hadolint-wasm32-cli.patch` lifts both. It is pinned to the submodule
commit and **must be rebased whenever `hadolint` moves**; `build.sh`
fails loudly if it stops applying.

## The digest history

**The build is not reproducible, and no digest is a guarantee.** Two from-scratch
builds of one recipe — build cache deleted for both, toolchain cache hit for
both, the cache miss quoted in the job log — produced different modules. Eight
distinct sha256 values are on record for one pinned submodule revision.

`wasm/digests.json` is therefore **history, not a reference value**: it lists
what identical inputs have actually produced. Nothing compares against it and
nothing fails on a mismatch, because that would fail on every run. An earlier
version of this file was a gate; it was retired for exactly that reason.

`wasm/check-digest.mjs <sha256>` reports whether a digest has been seen before
and always exits 0; `--record` appends. The recipe key it computes covers an
**explicit list** — `.github/workflows/wasm.yml`, `wasm/build-reactor.sh`, and
the wrapper's `cabal.project`, `.cabal` and `Main.hs` — and the build cache in
`wasm.yml` is keyed on the same list. **The two must stay in step**: a cache that
moves when the recipe does not makes the history unreadable.

`wasm/upstream-report.md` is the draft finding. Eight outputs from one source is
evidence, and evidence is what an upstream report needs.

### Traps this cost, all the same shape

Every one of these was a signal that looked like success and meant "did not
run". Recorded together, because the pattern rather than the individual bug is
what to watch for:

1. **Compute the recipe key after every other change in the commit.** It is
   correct when computed and stale on arrival. Recorded once before two later
   `wasm.yml` edits, it silently stopped matching, and the check took its
   _unrecorded_ path — which passed with a notice, so the step reported success
   and looked verified.
2. **A recipe hash that refuses to move is a signal.** A batch of edits that
   applies four of six changes, skipping two because a script exited on an
   earlier failed anchor, is caught by the hash not changing when a recipe file
   did. That is the same class as the trap above: a step that looks done.
3. **A green step is not a firing check.** The drift check reported `success`
   for its entire life while taking the path that compared nothing.
4. **Cleaning a comment can break a step.** A file-wide backtick `sed` intended
   for a YAML comment stripped the escapes from the step summary's `echo` lines,
   turning Markdown into command substitution — `v2.15.1: command not found`.
   Found by reading the log rather than the conclusion.

## Bootstrapping

A fresh checkout has no `hadolint.wasm`, and nothing fetches one — by design. CI
needs no bootstrap step: the `wasm` job builds it and every job that needs it
downloads the artifact, so a first-ever run works with nothing published.

There is no presence check any more — `scripts/hadolint-wasm.mjs` and its
`check:wasm` script are gone — and what stands in for it differs by path:

- **In CI, the job graph.** `ci.yml`, `pkg-pr-new.yml` and `size-limit.yml`
  download the artifact unconditionally, so a missing one fails that step.
  `release.yml` additionally requires `wasm` to have succeeded before it will
  publish, which it did not before: with `always()` and a download guarded by
  `needs.wasm.result == 'success'`, a _failed_ build still reached `pnpm release`
  and published a package with no wasm in it, green.
- **Locally, the test suite.** `test/reactor.spec.ts` reads `hadolint.wasm`
  directly, so `pnpm test` without one fails 19 of 20 tests with `ENOENT …
hadolint.wasm` rather than skipping them.

What nothing guards is the packaging path, and it is worth knowing rather than
assuming: with both files removed, `pnpm build` exits 0 and `pnpm pack` produces
a tarball containing `package.json` and no wasm at all, without complaint. That
is measured, not reasoned. Nothing in `pnpm build` or `pnpm pack` asserts the
binary exists — the only things in the way are the test suite and the job graph
around them.

## Publishing, and changesets

There is no separate release and no manual publish step. `release.yml` uses the
existing `changesets/action` flow and adds one thing:

|        |                                                                |
| ------ | -------------------------------------------------------------- |
| when   | only on the publish path — i.e. when no changesets are pending |
| builds | the same reusable `WASM` workflow `ci.yml` uses                |

`changeset publish` is untouched: it still publishes to npm and still creates its
own `v<version>` tag and release. What changed from the previous design is what
is **absent** — release assets.

An earlier version attached `hadolint.wasm`, `ghc_wasm_jsffi.js` and
`hadolint.wasm.sha256` to the release, and had `scripts/hadolint-wasm.mjs` fetch
them for `pretest`. That was removed because it bought nothing: a consumer
already gets the module from npm, so the release copy served only the developer
path — at the cost of a bootstrap cycle where `pretest` depended on an asset
that exists only after the release it is meant to precede.

### Why there is no digest check

There was one, and it was retired rather than repaired, because **the build is
not byte-reproducible**. Two builds of the same commit, the same toolchain, the
same dependency versions and the same index-state, with no build cache between
them, produced different bytes:

```
build 1  459d4d45a3497b2786f828f65628d501746acd48441b2a057649344d573fdddc
build 2  ce9027d2abc9b9f6fc6717d2a511d9ad64af4ee65cb15fc2621bff5eeb16efcd
```

`wasm-opt` is ruled out — repeated `-Oz --converge` on one input gives one
digest — so the nondeterminism is GHC's or `wasm-ld`'s, not ours to fix. A gate
that presupposes reproducibility cannot pass on a build that lacks it, and a
warning on a condition that is always true is indistinguishable from a check
that never ran. The measurements are in
[`upstream-report.md`](./upstream-report.md).

**What actually guarantees the shipped binary:** npm's content-addressed,
immutable tarball for _what_ was published, and the provenance attestation for
_where it came from_:

```sh
gh attestation verify hadolint.wasm -R wasmio/dlintr
```

**What nothing guarantees:** that a rebuild would produce the same bytes. It
would not.

## Two traps in this repository

Both cost a cycle each. They are unrelated to each other and to wasm.

**Declaring `permissions` on a job sets every scope it does not name to `none`.**
Dropping `contents: write` from the wasm job therefore left it with no `contents`
at all, and `actions/checkout` needs `contents: read`. A called workflow cannot
be granted a scope its caller denied, so the entire run died at **startup** —
`conclusion: startup_failure` with zero jobs, no log, and no annotation. If a
run is `startup_failure` with `total_count: 0`, look at permissions before
anything else. Keep `contents: read` on these jobs.

**`git add -A` and `git add -u` read an uninitialised submodule as deleted**, and
stage its removal, so a commit can silently drop the gitlink. That happened
once here. If `hadolint/` is not checked out, use `git add <paths>` rather than
`-A`/`-u`, or initialise it first:

```sh
git submodule update --init
git ls-files -s hadolint # expect a 160000 entry
```

## Building locally

`build.sh` and `build-reactor.sh` need the GHC wasm toolchain on `PATH` (which
brings `wasm32-wasi-cabal`) plus `wasm-opt`. `.github/workflows/wasm.yml` is the
authority on versions; in short it pins

|                          |                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `ghc-wasm-meta` revision | full commit hash; its `autogen.json` names the whole toolchain, so this pins it    |
| GHC wasm bindist         | `wasm32-wasi-ghc-9.10`, checked against the release asset's SHA-256 before install |
| `wasm-opt`               | binaryen 133, checked against a SHA-256                                            |

**`setup.sh` must run without `SKIP_GHC`, and with `FLAVOUR=9.10`.**

The bindist ships unconfigured, and it is `setup.sh`'s own
`./configure --target=wasm32-wasi` that makes it a wasm compiler. Running
`SKIP_GHC=1 setup.sh` and then configuring GHC yourself — as hadolint's own wasm
job does — without `--target=wasm32-wasi` yields a GHC that _reports_ a wasm
target while emitting x86-64 assembly. `wasm32-wasi-clang` then rejects it with
`Wasm doesn't support data symbols in text sections`, because it is being handed
`.section …,"ax",@progbits`.

`FLAVOUR` must be `9.10` because the default is `9.14`, and hadolint requires
`ghc-experimental >=9.1003 && <9.1201`, which 9.14 cannot satisfy.

```sh
git clone https://gitlab.haskell.org/haskell-wasm/ghc-wasm-meta.git
git -C ghc-wasm-meta checkout <the revision pinned in wasm.yml>
FLAVOUR=9.10 ghc-wasm-meta/setup.sh
source ~/.ghc-wasm/env

git submodule update --init
pnpm build:wasm                  # `bash wasm/build-reactor.sh`; writes both files
node wasm/calls.mjs              # what WASI imports it actually calls
node wasm/smoke.mjs hadolint.wasm # only for the *command* build, see below
```

`build:wasm` is deliberately **not** part of `pnpm build`. It needs a toolchain
that a contributor and a Windows runner may not have, and in CI the binary is
built once by the `WASM` workflow and downloaded, so folding it in would make
every ordinary build pay for a compiler or fail without one.

To test against a binary you built yourself, put it in place — `build-reactor.sh`
already writes to the package root — and run the suite. Nothing is fetched, so
there is no skip flag to remember:

```sh
pnpm test
```

### Windows

There is no native path. `ghc-wasm-meta`'s `setup.sh` branches on Linux and
macOS hosts only, so the toolchain cannot be installed on Windows at all — and
neither this file nor upstream's says otherwise.

A Windows contributor does not need to build the module. CI already did:

```sh
gh run download --repo wasmio/dlintr --name hadolint-wasm
```

A published npm tarball carries both files as well (`npm pack dlintr`). To build
one anyway, use WSL2 and check out inside the Linux filesystem rather than under
`/mnt/c`.

That asymmetry is exactly why CI builds this once and shares it as an artifact
instead of each matrix leg building its own. The Windows legs cannot produce it,
but `test/reactor.spec.ts` needs it — so the artifact path has to exist, and
once it does, having the other eight legs build a second copy of a
host-independent wasm module is only cost.

## Updating hadolint

```sh
cd hadolint
git fetch --tags && git checkout v<new-version>
cd ../..
# rebase wasm/hadolint-wasm32-cli.patch onto the new hadolint.cabal if needed
git add hadolint
```

Then let the normal release flow carry it: the next publish run rebuilds the
binary and packs it. Nothing else needs editing — no URL to update and no digest
to re-record, because nothing fetches the artifact from anywhere.
