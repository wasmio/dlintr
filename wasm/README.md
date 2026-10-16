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
   (the command, for the test). `release.yml` attaches `hadolint.wasm`,
   `ghc_wasm_jsffi.js` and the `.sha256` to the release changesets creates.
3. `scripts/hadolint-wasm.mjs` fetches that asset for this package's version and
   verifies it against the digest published beside it — see
   [the digest](#the-digest) for why that is not a constant in the script.

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

## Bootstrapping

A fresh checkout has no `hadolint.wasm` and no release to fetch it from, so the
first run that carries one is:

1. Push a branch containing these changes. The `CI` workflow's `wasm` job calls
   the reusable `WASM` workflow, builds the binary, and hands the artifact to
   the test matrix in the same run — that path needs nothing published.
2. Merge, and let the normal changesets flow release. On the publish run,
   `release.yml` builds the binary, `pnpm release` packs it into the npm tarball,
   and the artifact is then attached to the `v<version>` release changesets
   creates.
3. From that point `pnpm test` on a clean checkout fetches and verifies it.

Until step 2 there is nothing to download. Local runs are unaffected if the file
is already on disk; the downloader says so and carries on rather than failing.

## Publishing, and changesets

There is no separate release and no manual publish step. `release.yml` uses the
existing `changesets/action` flow and adds two things:

|             |                                                                |
| ----------- | -------------------------------------------------------------- |
| when        | only on the publish path — i.e. when no changesets are pending |
| builds      | the same reusable `WASM` workflow `ci.yml` uses                |
| attaches to | the release changesets creates, tagged `v<version>`            |
| assets      | `hadolint.wasm`, `ghc_wasm_jsffi.js`, `hadolint.wasm.sha256`   |

`changeset publish` is untouched: it still publishes to npm and still creates its
own `v<version>` tag and release. All this adds is three assets to that release: the module, its glue, and the
digest. The glue is not optional — the exports are unreachable without it.

`scripts/hadolint-wasm.mjs` derives the URL from this package's own version, so
no tag is hand-edited per release and `releases/latest` is never used — an older
package keeps fetching its own artifact rather than a newer binary.

### The digest

The digest is read from the `.sha256` published beside the artifact, and a
mismatch is a hard error. It is deliberately **not** a constant in the script,
because the build is not byte-reproducible. Two builds of the same commit and
toolchain produced `82168e57a1dd722bfde49090849b75c26f58124e5a5f31cffdaf4200bcf9ab2c`
and `64c2c74407a5a91750c2f82b79ea82e3d5a3e8d8449d5b45b3a664819bc872a9`.

That is not the Hackage index moving underneath the build: both runs recorded
the same index-state (`2026-10-15T11:34:24Z`), resolved the same versions of
every dependency, and `wasm-opt` is deterministic — repeated `-Oz --converge`
runs on one input give one digest. The two artifacts are the same size to within
two bytes and differ across the whole code section, so the nondeterminism is
GHC's own. Pinning `index-state` would not fix it.

**What the digest guarantees:** corruption, truncation or a partially uploaded
asset is caught, and an artifact that does not match what was published is
refused.

**What it does not guarantee:** anyone able to replace both the artifact and its
`.sha256` in the release. That is what the provenance attestation is for, and
why both exist:

```sh
gh attestation verify hadolint.wasm -R wasmio/dlintr
```

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

`build.sh` needs the GHC wasm toolchain on `PATH` (which brings
`wasm32-wasi-cabal`) plus `wasm-opt`. `.github/workflows/wasm.yml` is the
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
bash wasm/build-reactor.sh        # writes ./hadolint.wasm + ./ghc_wasm_jsffi.js
node wasm/calls.mjs              # what WASI imports it actually calls
node wasm/smoke.mjs hadolint.wasm # only for the *command* build, see below
```

To test against a binary you built yourself, put it in place and tell the
downloader not to fetch one:

```sh
HADOLINT_WASM_SKIP_FETCH=1 pnpm test
```

## Updating hadolint

```sh
cd hadolint
git fetch --tags && git checkout v<new-version>
cd ../..
# rebase wasm/hadolint-wasm32-cli.patch onto the new hadolint.cabal if needed
git add hadolint
```

Then let the normal release flow carry it: the next publish run rebuilds the
binary and attaches it to that release. Nothing needs editing in
`scripts/hadolint-wasm.mjs` — the URL follows the package version and the digest
is read from what was published.
