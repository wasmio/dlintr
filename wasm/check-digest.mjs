/**
 * What has this recipe actually produced before?
 *
 * Identical inputs do **not** reliably produce identical bytes here: two
 * from-scratch builds of one recipe, with no build cache and the toolchain
 * identical, produced different modules. So this is not a gate and the workflow
 * does not run it. It records observations, and reports whether the current
 * build's digest is one that has been seen before.
 *
 * Kept as an instrument because eight distinct outputs from one pinned source is
 * the evidence for `wasm/upstream-report.md`, and because the next person to
 * doubt the claim should be able to reproduce the observation rather than take
 * it on trust.
 *
 * Usage:
 *   node wasm/check-digest.mjs <observed-sha256>
 *   node wasm/check-digest.mjs --record <observed-sha256>
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const wasmDir = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(wasmDir, '..')
const history = path.join(wasmDir, 'digests.json')

/** Enough of the hash to identify a recipe without quoting a wall of hex. */
const RECIPE_HASH_LENGTH = 16

/**
 * The files that decide the reactor's bytes, named explicitly — the same list
 * the build cache in `wasm.yml` is keyed on. The two must stay in step, or a
 * cache that moves when the recipe does not makes the history unreadable.
 *
 * `wasm/build.sh` and the CLI patch are absent on purpose: they build the
 * command*, which the format test compares against, not this reactor.
 */
const RECIPE_INPUTS = [
  '.github/workflows/wasm.yml',
  'wasm/build-reactor.sh',
  'wasm/hadolint-wasi/cabal.project',
  'wasm/hadolint-wasi/hadolint-wasi.cabal',
  'wasm/hadolint-wasi/Main.hs',
]

/**
 * @returns {string[]} Absolute paths of the recipe inputs.
 */
const recipeFiles = () =>
  RECIPE_INPUTS.map(relative => path.join(root, relative)).sort()

/**
 * Computed here rather than with GitHub's `hashFiles`, so the same key can be
 * derived locally — which is what makes `--record` meaningful off CI.
 *
 * Compute it **after every other change in the commit**: it is correct when
 * computed and stale on arrival, because any later edit to a recipe file moves
 * it.
 *
 * @returns {string} A short, stable hash of the recipe.
 */
const recipeHash = () => {
  const hash = createHash('sha256')
  for (const file of recipeFiles()) {
    hash.update(path.relative(root, file))
    hash.update('\0')
    hash.update(readFileSync(file))
    hash.update('\0')
  }
  return hash.digest('hex').slice(0, RECIPE_HASH_LENGTH)
}

/**
 * The submodule gitlink, read from `HEAD` so a bare clone works too.
 *
 * @returns {string} The pinned hadolint revision.
 */
const submoduleRevision = () =>
  // A fixed command name, not a lookup through a writable PATH, which is what
  // the rule guards against.
  // eslint-disable-next-line sonarjs/no-os-command-from-path
  execFileSync('git', ['-C', root, 'rev-parse', 'HEAD:hadolint'])
    .toString()
    .trim()

const main = () => {
  const args = process.argv.slice(2)
  const record = args.includes('--record')
  const observedDigest = args.find(argument => !argument.startsWith('--'))

  if (!observedDigest || !/^[0-9a-f]{64}$/.test(observedDigest)) {
    console.error('usage: node wasm/check-digest.mjs [--record] <sha256>')
    return 2
  }

  const key = `${submoduleRevision()}:${recipeHash()}`
  const digests = JSON.parse(readFileSync(history, 'utf8'))
  const entry = digests[key]

  if (record) {
    const observed = entry?.observed ?? []
    if (!observed.includes(observedDigest)) {
      observed.push(observedDigest)
    }
    digests[key] = { hadolint: entry?.hadolint ?? '', observed }
    writeFileSync(history, `${JSON.stringify(digests, null, 2)}\n`)
    console.log(`recorded ${key} -> ${observedDigest}`)
    return 0
  }

  if (!entry) {
    console.log(
      `${key} has no history yet; this is the first build of it.\n\n  observed  ${observedDigest}`,
    )
  } else if (entry.observed.includes(observedDigest)) {
    console.log(
      `${key} has produced this digest before (1 of ${entry.observed.length} on record).\n\n  observed  ${observedDigest}`,
    )
  } else {
    console.log(
      [
        `${key} has not produced this digest before.`,
        '',
        `  observed  ${observedDigest}`,
        `  on record ${entry.observed.length}, none equal to it`,
        '',
        'Expected, not a failure: the build is not reproducible. To add it to the',
        'history anyway:',
        '',
        `  node wasm/check-digest.mjs --record ${observedDigest}`,
      ].join('\n'),
    )
  }

  return 0
}

process.exitCode = main()
