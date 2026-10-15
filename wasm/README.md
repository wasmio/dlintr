# `hadolint.wasm`

The WASI build of [hadolint](https://github.com/hadolint/hadolint) this package
ships. It is a build artifact, so it is produced by
`.github/workflows/wasm.yml` and never committed — it is gitignored, and it is
the only thing in the published package that is not source.

## Where the binary comes from

There is one source, and it is this repository:

1. `wasm/build.sh` builds hadolint's CLI (`exe:hadolint`) for `wasm32-wasi` out
   of the `vendor/hadolint` submodule, which is pinned to a release tag.
2. The `WASM` workflow runs that, smoke-tests the result, and — on manual
   dispatch with `publish` — attaches `hadolint.wasm` and its `.sha256` to the
   `hadolint-wasm` release.
3. `scripts/hadolint-wasm.mjs` fetches that asset and verifies the digest
   pinned in `HADOLINT_SHA256`.

The digest is the pin, not the URL: a re-published or replaced asset fails
verification rather than being silently accepted.

### Why not upstream's own wasm build

hadolint does compile to wasm, and publishes the result to its website. That
module is a JSFFI _reactor_: its `setup` and `lint` exports read from the site's
DOM (`#lint`, `#dockerfile__code`, `#version`), it has no `_start`, and it is
deployed as a GitHub Pages site rather than a versioned, checksummed asset.
This package needs a WASI _command_ — imports `wasi_snapshot_preview1`, exports
`_start` — because that is what `node:wasi` and `browser_wasi_shim` execute.

Upstream also marks `exe:hadolint` as `buildable: False` on wasm32 and passes it
`-threaded`, which wasm32-wasi cannot link.
`wasm/hadolint-wasm32-cli.patch` lifts both. It is pinned to the submodule
commit and **must be rebased whenever `vendor/hadolint` moves**; `build.sh`
fails loudly if it stops applying.

## Bootstrapping

A fresh checkout has no `hadolint.wasm` and nothing published to fetch it from,
so the first successful run is:

1. Push a branch containing these changes. The `CI` workflow's `wasm` job calls
   the reusable `WASM` workflow, builds the binary, and hands the artifact to
   the test matrix in the same run — that path needs nothing published.
2. Once that build is green, run the `WASM` workflow manually with
   `publish: true`. It creates the release described below and uploads
   `hadolint.wasm` and `hadolint.wasm.sha256`.
3. Copy the sha256 from that job's summary into `HADOLINT_SHA256` in
   `scripts/hadolint-wasm.mjs`. Until it is filled in, that script refuses to
   download — there is nothing to verify a download against — which is why
   `pretest` only works locally from step 3 onwards.
4. Commit the digest.

From then on `pnpm test` on a clean checkout fetches and verifies the artifact
itself.

## Publishing, and changesets

Publishing is manual (`workflow_dispatch` with `publish: true`) and creates
exactly one kind of release:

|          |                                                                     |
| -------- | ------------------------------------------------------------------- |
| tag      | `wasm-hadolint-v2.15.1` — `wasm-hadolint-` plus the submodule's tag |
| kind     | prerelease, so it never becomes the repository's "latest"           |
| assets   | `hadolint.wasm`, `hadolint.wasm.sha256`                             |
| contents | the wasm binary only; it never touches the package or its version   |

The namespace is deliberately disjoint from the `dlintr@<version>` tags
`changeset publish` creates, and this workflow does not tag, version or publish
the package, so the changesets flow is unaffected. The tag is versioned rather
than rolling so one URL always means one artifact: bumping hadolint means a new
tag, and `WASM_RELEASE_TAG` in the workflow and `HADOLINT_URL` in
`scripts/hadolint-wasm.mjs` move together. The publish step **fails** if the
submodule and the tag disagree, rather than quietly putting a new binary behind
the old URL.

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
bash wasm/build.sh                # writes ./hadolint.wasm
node wasm/smoke.mjs hadolint.wasm # starts it and lints a Dockerfile
```

To test against a binary you built yourself, put it in place and tell the
downloader not to fetch one:

```sh
HADOLINT_WASM_SKIP_FETCH=1 pnpm test
```

## Updating hadolint

```sh
cd vendor/hadolint
git fetch --tags && git checkout v<new-version>
cd ../..
# rebase wasm/hadolint-wasm32-cli.patch onto the new hadolint.cabal if needed
git add vendor/hadolint
```

Then rebuild, publish, and update `HADOLINT_SHA256` as in
[Bootstrapping](#bootstrapping).
