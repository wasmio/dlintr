/**
 * Fetches the pinned `hadolint` WASI binary.
 *
 * The binary is a build artifact, not source: it is a GHC-compiled Haskell
 * program. This package therefore produces it itself, in
 * `.github/workflows/wasm.yml`, from the `vendor/hadolint` submodule pinned at
 * a release tag; no binary from any other project is involved.
 *
 * The URL is not the pin — the SHA-256 is. `HADOLINT_SHA256` is what decides
 * whether the file on disk is the binary we mean, and updating it, together
 * with republishing the `hadolint-wasm` release asset, is the whole of what a
 * rebuild requires.
 *
 * Two cases skip the network entirely:
 *
 *  - the file on disk already hashes to `HADOLINT_SHA256`;
 *  - `HADOLINT_WASM_SKIP_FETCH` is set, which is how CI says "the WASM workflow
 *    already put the build it just made here". That is what keeps a fresh
 *    checkout, and a first ever CI run, working before any artifact has been
 *    published.
 *
 * It is written to the package root, one level above both `src/` and `lib/`, so
 * `new URL('../hadolint.wasm', import.meta.url)` resolves identically when
 * running from the sources (vitest) and from the build output (published).
 */
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Asset published by `.github/workflows/wasm.yml`. */
export const HADOLINT_URL =
  'https://github.com/wasmio/dlintr/releases/download/hadolint-wasm/hadolint.wasm'

/**
 * SHA-256 of the artifact at `HADOLINT_URL`.
 *
 * Taken from the `WASM` workflow's job summary when a build is published.
 * While it is empty there is nothing to verify against, so this script refuses
 * to download rather than trusting whatever the URL returns.
 */
export const HADOLINT_SHA256 = ''

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * @param {Buffer | Uint8Array} buffer
 * @returns {string} Lowercase hex digest.
 */
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex')

/**
 * @param {string} file
 * @returns {Promise<string | undefined>} Digest, or `undefined` when absent.
 */
const digestOf = async file => {
  try {
    return sha256(await readFile(file))
  } catch {}
}

const main = async () => {
  const target = path.join(root, 'hadolint.wasm')

  if (process.env.HADOLINT_WASM_SKIP_FETCH) {
    return
  }

  const force = process.argv.includes('--force')
  const current = await digestOf(target)

  if (HADOLINT_SHA256 && !force && current === HADOLINT_SHA256) {
    return
  }

  if (!HADOLINT_SHA256) {
    // Nothing has been published yet, so there is no digest to check against.
    // A binary already on disk was built or placed here deliberately, and
    // refusing to run would break local development for no gain; say plainly
    // that it is unverified and carry on. With nothing on disk there is no
    // honest option but to stop and explain how to get one.
    if (current && !force) {
      process.stderr.write(
        'dlintr: HADOLINT_SHA256 is not set, using the existing hadolint.wasm unverified\n',
      )
      return
    }

    throw new Error(
      [
        'hadolint.wasm has no pinned digest yet.',
        '',
        'This package ships a WASI build of hadolint that it produces itself in',
        'the `WASM` workflow (.github/workflows/wasm.yml). Until a build has been',
        'published to the `hadolint-wasm` release there is nothing to fetch, and',
        'nothing to verify a download against.',
        '',
        'Either publish a build — run the `WASM` workflow and copy the sha256 it',
        'reports into HADOLINT_SHA256 in this file — or build one locally:',
        '',
        '  git submodule update --init',
        '  source ~/.ghc-wasm/env',
        '  bash wasm/build.sh',
        '  HADOLINT_WASM_SKIP_FETCH=1 pnpm test',
      ].join('\n'),
    )
  }

  process.stderr.write(`dlintr: fetching hadolint.wasm\n`)
  const response = await fetch(HADOLINT_URL)
  if (!response.ok) {
    throw new Error(
      `failed to download ${HADOLINT_URL}: ${response.status} ${response.statusText}`,
    )
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  const digest = sha256(buffer)
  if (digest !== HADOLINT_SHA256) {
    throw new Error(
      `hadolint.wasm checksum mismatch\n  expected ${HADOLINT_SHA256}\n  received ${digest}`,
    )
  }

  await writeFile(target, buffer)
  process.stderr.write(
    `dlintr: hadolint.wasm ready (${(buffer.byteLength / 1024 / 1024).toFixed(
      1,
    )} MiB)\n`,
  )
}

await main()
