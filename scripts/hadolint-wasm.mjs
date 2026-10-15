/**
 * Fetches the `hadolint` WASI binary for this version of the package.
 *
 * The binary is a build artifact, not source: `.github/workflows/wasm.yml`
 * compiles it from the `hadolint` submodule, and `release.yml` attaches it to
 * the release changesets creates. There is no other source.
 *
 * The URL is derived from this package's own version, so `v0.2.0` always
 * names the artifact that shipped with it. Deliberately not
 * `releases/latest`: an older package fetching a newer binary would fail its own
 * digest check at best, and quietly run different rules at worst.
 *
 * The digest is the one published beside the artifact, and a mismatch is a hard
 * error. It cannot be a constant in this file: two builds of identical sources
 * do not produce identical bytes (measured — `82168e5…` and `64c2c74…` from the
 * same commit and toolchain), so a constant here would be wrong the moment the
 * binary is rebuilt. Origin is covered separately by the build provenance
 * attestation the workflow publishes:
 *
 *   gh attestation verify hadolint.wasm -R wasmio/dlintr
 *
 * Two cases skip the network:
 *
 *  - the file on disk already hashes to the published digest;
 *  - `HADOLINT_WASM_SKIP_FETCH` is set, which is how a workflow that has just
 *    built the binary itself says "it is already here".
 *
 * It is written to the package root, one level above both `src/` and `lib/`, so
 * `new URL('../hadolint.wasm', import.meta.url)` resolves identically when
 * running from the sources (vitest) and from the build output (published).
 */
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

/**
 * The version whose release holds the artifact.
 *
 * @returns {Promise<string>} The `version` field of this package's manifest.
 */
const packageVersion = async () =>
  JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version

/**
 * @param {string} url
 * @returns {Promise<Response>} A response that is known to be ok.
 */
const get = async url => {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`)
  }
  return response
}

const main = async () => {
  const target = path.join(root, 'hadolint.wasm')

  if (process.env.HADOLINT_WASM_SKIP_FETCH) {
    return
  }

  const force = process.argv.includes('--force')
  const current = await digestOf(target)
  const version = await packageVersion()
  const url = `https://github.com/wasmio/dlintr/releases/download/v${version}/hadolint.wasm`

  let expected
  try {
    const response = await get(`${url}.sha256`)
    const published = await response.text()
    expected = published.trim().split(/\s+/)[0]
  } catch (error) {
    // Nothing published for this version yet. That is what the repository looks
    // like between adding this machinery and cutting the first release that
    // carries it: a binary already on disk is fine, silence is not.
    if (current && !force) {
      process.stderr.write(
        `dlintr: no published hadolint.wasm for dlintr@${version} (${error.message})\n` +
          'dlintr: using the existing hadolint.wasm unverified\n',
      )
      return
    }

    throw new Error(
      [
        `nothing to fetch: dlintr@${version} has no published hadolint.wasm.`,
        '',
        'The binary is built by the `WASM` workflow and attached to the release',
        'changesets creates, so it exists once a release carrying it has been',
        'cut. Until then, build one locally:',
        '',
        '  git submodule update --init',
        '  source ~/.ghc-wasm/env',
        '  bash wasm/build.sh',
        '  HADOLINT_WASM_SKIP_FETCH=1 pnpm test',
      ].join('\n'),
      { cause: error },
    )
  }

  if (!force && current === expected) {
    return
  }

  process.stderr.write(`dlintr: fetching hadolint.wasm for dlintr@${version}\n`)
  const response = await get(url)
  const buffer = Buffer.from(await response.arrayBuffer())
  const digest = sha256(buffer)
  if (digest !== expected) {
    throw new Error(
      `hadolint.wasm checksum mismatch\n  expected ${expected}\n  received ${digest}`,
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
