/**
 * Fetches the pinned `hadolint` WASI binary.
 *
 * The binary is a build artifact, not source: it is a ~12.4 MB GHC-compiled
 * Haskell program that we have no way to rebuild here. So we pin the exact
 * upstream commit and verify the SHA-256 of what we download rather than
 * trusting `main` to stay put.
 *
 * It is written to the package root, one level above both `src/` and `lib/`, so
 * `new URL('../hadolint.wasm', import.meta.url)` resolves identically when
 * running from the sources (vitest) and from the build output (published).
 */
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Upstream commit of https://github.com/wasilibs/go-hadolint. */
export const HADOLINT_COMMIT = '1f2912ea33a1082b05c6364bdcef9ef0d3844439'

/** SHA-256 of `internal/wasm/hadolint.wasm` at the commit above. */
export const HADOLINT_SHA256 =
  '8a48265280909161c58cf83d9fe10dcf184a8401f996de7e42149a8f56594ab3'

const SOURCE = `https://raw.githubusercontent.com/wasilibs/go-hadolint/${HADOLINT_COMMIT}/internal/wasm/hadolint.wasm`

/** How much of the commit to show when reporting progress. */
const SHORT_SHA = 8

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
  const force = process.argv.includes('--force')
  const target = path.join(root, 'hadolint.wasm')

  if (!force && (await digestOf(target)) === HADOLINT_SHA256) {
    return
  }

  process.stderr.write(
    `dlintr: downloading hadolint.wasm (${HADOLINT_COMMIT.slice(
      0,
      SHORT_SHA,
    )})\n`,
  )
  const response = await fetch(SOURCE)
  if (!response.ok) {
    throw new Error(
      `failed to download ${SOURCE}: ${response.status} ${response.statusText}`,
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
