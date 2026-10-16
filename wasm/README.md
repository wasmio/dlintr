# `hadolint.wasm`

The WASI build of [hadolint](https://github.com/hadolint/hadolint) this package
ships. It is a build artifact: produced by `wasm/build-reactor.sh`, gitignored,
never committed, and the only thing in the published package that is not source.

## Where the binary comes from

There is one source, and it is this repository. `pnpm build:wasm` produces both
files in the package root:

1. `wasm/build-reactor.sh` builds the **reactor** the runtime calls, out of the
   `hadolint` submodule (pinned to a release tag): `hadolint.wasm` plus
   `ghc_wasm_jsffi.js`, GHC's half of the JSFFI. Both are needed — the exports
   are unreachable without the glue.
   `wasm/build.sh` builds the CLI (`exe:hadolint`) as a WASI _command_ instead.
   That is kept as the reference the byte-equality test compares against, and is
   **not** what the runtime loads: `createReactor` rejects a command module.
2. `scripts/build-wasm.mjs` is what `pnpm build:wasm` runs. On Linux and macOS it
   delegates to `wasm/build-reactor.sh`; on Windows it hands the same recipe to
   WSL2 — see [Windows](#windows).
3. `wasm/toolchain.sh` installs the toolchain, and `wasm/toolchain.sh` is where
   the versions are pinned. `.github/actions/wasm-toolchain` wraps it for CI.

Nothing is fetched and nothing is attached to a release. The npm tarball is the
delivery, and it is the content-addressed, immutable one.

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

## The toolchain

`wasm/toolchain.sh` installs it and **is the one place the versions are pinned**,
so a cache key or a CI env block cannot drift from what is actually installed.

|                          |                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `ghc-wasm-meta` revision | full commit hash; its `autogen.json` names the whole toolchain, so this pins it    |
| GHC wasm bindist         | `wasm32-wasi-ghc-9.10`, checked against the release asset's SHA-256 before install |
| `wasm-opt`               | binaryen 133, checked against a SHA-256, one digest per supported host             |

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

The script ends by compiling and **running** a hello world. If the pinned
toolchain cannot do that, it cannot compile any Haskell, and the fault is the
toolchain rather than our cabal invocation — which is worth knowing before a
fifteen-minute build rather than after it.

### Windows

There is no native path: `ghc-wasm-meta`'s `setup.sh` branches on Linux and
macOS hosts only. So on Windows the toolchain is installed **inside WSL2**, and
the build runs there too, with the two outputs copied back into the Windows
workspace — the tests run natively on Windows and load them from the package
root.

`wsl --install -d Ubuntu --no-launch` takes about 23 seconds on a runner, and a
fresh Ubuntu needs `jq`, `make` and `unzip` installed (`curl`, `tar` and `xz`
are already there).

The build happens in WSL's own filesystem rather than over the `/mnt/<drive>`
mount the checkout is on: cabal writes `dist-newstyle` as thousands of small
files, and 9p turns that into the difference between a build and a timeout.
`wasm/wsl-build.sh` copies the sources in and the two outputs back out.

**`TMPDIR` has to be moved off `/tmp`, and that is not a preference.** WSL2's
`/tmp` is a 3.9 GB tmpfs, and `setup.sh` stages both its downloads and the
extracted GHC tree in `$(mktemp -d)`. Without the move the install dies part way
through with

```
tar: wrappers/wasm32-wasi-hp2ps-ghc-9.10.3.20260403: Cannot write: No space left on device
```

which reads like a disk limit and is not one — WSL2's ext4 has room, and the
Windows drive has plenty. Both `wasm/toolchain.sh` and `wasm/wsl-build.sh` set
`TMPDIR=$HOME/tmp`, unconditionally, so the trap cannot be re-introduced by
running one without the other.

CI pins `windows-2025` rather than `windows-latest`, because only the 2025 image
has WSL2; `windows-2022` has WSL1 and GitHub closed the request for WSL2 on it
as won't-fix (`actions/runner-images` #10563).

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
**explicit list** — `wasm/toolchain.sh`, `wasm/build-reactor.sh`, and the
wrapper's `cabal.project`, `.cabal` and `Main.hs` — and the build cache in
`.github/actions/wasm-toolchain/action.yml` is keyed on the same list. **The two
must stay in step**: a cache that moves when the recipe does not makes the
history unreadable. `wasm/toolchain.sh` is on that list because it holds the pins,
and the pinned `wasm-opt` decides the artifact's bytes as surely as the Haskell
sources do.

`wasm/upstream-report.md` is the finding as it was filed upstream.

### Traps this cost, all the same shape

Every one of these was a signal that looked like success and meant "did not
run". Recorded together, because the pattern rather than the individual bug is
what to watch for:

1. **Compute the recipe key after every other change in the commit.** It is
   correct when computed and stale on arrival. Recorded once before two later
   edits to the build recipe, it silently stopped matching, and the check took
   its _unrecorded_ path — which passed with a notice, so the step reported
   success and looked verified.
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

A fresh checkout has no `hadolint.wasm`, and there is nothing to fetch it from —
by design. Install the toolchain once and build it:

```sh
bash wasm/toolchain.sh # once; pins live in the script
pnpm build:wasm        # writes ./hadolint.wasm + ./ghc_wasm_jsffi.js
pnpm test
```

CI needs no bootstrap step: every matrix leg installs the toolchain and builds
the reactor itself, and the publish runs do the same before packing.

## Publishing, and changesets

There is no separate release and no manual publish step. `release.yml` uses the
existing `changesets/action` flow, and what it adds over that is what is
**absent**: no build job, no artifact, no release assets.

`pnpm release` runs the `prerelease` hook, `pnpm build`, which builds the module
and packs it into the tarball. `changeset publish` then does what it always did.
Nothing is attached to the release: a consumer gets the module from npm, so a
release copy served only the developer path — and made `pretest` depend on an
asset that exists only after the release it was meant to precede.

The provenance attestation is emitted **after** the publish, and that ordering is
forced rather than chosen. The build is not byte-reproducible, so building the
module early to attest it and letting `prerelease` build it again would sign a
file that is not the one packed. The file still on disk afterwards is.

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
This cost a whole run once: the wasm job called a reusable workflow and dropped
`contents: write`, which left it with no `contents` at all, and a called workflow
cannot be granted a scope its caller denied. The run died at **startup** —
`conclusion: startup_failure` with zero jobs, no log, and no annotation. That
reusable workflow is gone, but the rule is not: if a run is `startup_failure`
with `total_count: 0`, look at permissions before anything else. `release.yml`
needs `attestations: write` alongside the scopes it already names.

**`git add -A` and `git add -u` read an uninitialised submodule as deleted**, and
stage its removal, so a commit can silently drop the gitlink. That happened
once here. If `hadolint/` is not checked out, use `git add <paths>` rather than
`-A`/`-u`, or initialise it first:

```sh
git submodule update --init
git ls-files -s hadolint # expect a 160000 entry
```

## Building locally

```sh
git submodule update --init
bash wasm/toolchain.sh # once; needs jq, make, unzip, xz, zstd, curl, git
pnpm build:wasm        # writes ./hadolint.wasm + ./ghc_wasm_jsffi.js
pnpm test
```

`build-reactor.sh` sources `~/.ghc-wasm/wasm-env` for itself, so there is no
`source` step to remember and no way to half-set a `PATH`.

`node wasm/calls.mjs` lists what WASI imports the module actually calls, which is
what `src/wasi.ts` implements. `node wasm/smoke.mjs <file>` runs a module end to
end; it applies to the _command_ build, which exports `_start`.

## Updating hadolint

```sh
cd hadolint
git fetch --tags && git checkout v<new-version>
cd ../..
# rebase wasm/hadolint-wasm32-cli.patch onto the new hadolint.cabal if needed
git add hadolint
```

Then let the normal release flow carry it: the next publish rebuilds the binary
as part of packing. Nothing else needs editing — there is no URL to update and no
digest to re-record, because nothing fetches the artifact any more.
