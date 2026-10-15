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
   `publish: true`. It creates the `hadolint-wasm` release and uploads
   `hadolint.wasm` and `hadolint.wasm.sha256`.
3. Copy the sha256 from that job's summary into `HADOLINT_SHA256` in
   `scripts/hadolint-wasm.mjs`. Until it is filled in, that script refuses to
   download — there is nothing to verify a download against — which is why
   `pretest` only works locally from step 3 onwards.
4. Commit the digest.

From then on `pnpm test` on a clean checkout fetches and verifies the artifact
itself.

## Building locally

`build.sh` needs the GHC wasm toolchain on `PATH`, plus `cabal` and `wasm-opt`.
The versions CI uses are pinned in `.github/workflows/wasm.yml`; the toolchain
is distributed by
[`ghc-wasm-meta`](https://gitlab.haskell.org/haskell-wasm/ghc-wasm-meta):

```sh
curl https://gitlab.haskell.org/haskell-wasm/ghc-wasm-meta/-/raw/master/bootstrap.sh | sh
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
