/**
 * Is this build's wasm the one that identical inputs produced before?
 *
 * The build is *usually* reproducible and occasionally diverges, and the
 * divergence is the interesting event: a module that differs for identical
 * inputs is either nondeterminism worth knowing about or corruption. This
 * records a digest per (submodule revision, recipe hash) and fails when a build
 * disagrees with it.
 *
 * It is justified by anomaly detection on its own. A divergent build is *also*
 * the one so far observed to crash a test runner, but that rests on a single
 * sample and nothing here depends on it.
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
const manifest = path.join(wasmDir, 'digests.json')

/** Enough of the hash to identify a recipe without quoting a wall of hex. */
const RECIPE_HASH_LENGTH = 16

/**
 * The files that decide the reactor's bytes, named explicitly.
 *
 * Explicit rather than a walk, for two reasons in opposite directions. A walk
 * over `wasm/` misses `.github/workflows/wasm.yml`, which is where the GHC
 * bindist and Binaryen pins live — so a toolchain bump would leave the hash
 * unchanged, the newly built digest would differ correctly, and the check would
 * report **drift**: crying wolf on exactly the deliberate change it must allow,
 * and inviting the override that kills a canary. And a walk also sweeps in
 * `wasm/README.md`, `wasm/calls.mjs` and local `dist-newstyle` trees, which
 * cannot change a byte — the opposite failure, a hash that moves for edits which
 * mean nothing.
 *
 * `wasm/build.sh` and `hadolint-wasm32-cli.patch` are absent on purpose: they
 * build the *command*, which is the reference the format test compares against,
 * not the reactor whose digest this keys.
 */
const RECIPE_INPUTS = [
  // The toolchain pins, and the wiring that consumes them.
  '.github/workflows/wasm.yml',
  // How the reactor is built.
  'wasm/build-reactor.sh',
  // The wrapper itself.
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
  // A fixed command name, not a lookup through a writable PATH, which is
  // what the rule guards against.
  // eslint-disable-next-line sonarjs/no-os-command-from-path
  execFileSync('git', ['-C', root, 'rev-parse', 'HEAD:hadolint'])
    .toString()
    .trim()

const main = () => {
  const args = process.argv.slice(2)
  const record = args.includes('--record')
  const observed = args.find(argument => !argument.startsWith('--'))

  if (!observed || !/^[0-9a-f]{64}$/.test(observed)) {
    console.error('usage: node wasm/check-digest.mjs [--record] <sha256>')
    return 2
  }

  const key = `${submoduleRevision()}:${recipeHash()}`
  const digests = JSON.parse(readFileSync(manifest, 'utf8'))
  const recorded = digests[key]

  if (record) {
    digests[key] = { sha256: observed, hadolint: digests[key]?.hadolint ?? '' }
    writeFileSync(manifest, `${JSON.stringify(digests, null, 2)}\n`)
    console.log(`recorded ${key} -> ${observed}`)
    return 0
  }

  if (!recorded) {
    console.log(
      [
        `No digest recorded for ${key}.`,
        '',
        'That is not a divergence — it is a combination nobody has recorded yet,',
        'which is what every submodule bump or recipe change looks like the first',
        'time. The build is unaffected.',
        '',
        'To have this combination checked from now on:',
        '',
        `  node wasm/check-digest.mjs --record ${observed}`,
        '',
        'and commit wasm/digests.json with your change.',
      ].join('\n'),
    )
    return 0
  }

  if (recorded.sha256 === observed) {
    console.log(`wasm digest matches the recorded value for ${key}`)
    return 0
  }

  console.log(
    [
      'This is a divergence, and it deliberately stops the build.',
      '',
      `  inputs    ${key}`,
      `  recorded  ${recorded.sha256}`,
      `  observed  ${observed}`,
      '',
      'Identical inputs are expected to produce identical bytes. Usually they do.',
      'When they do not, either something under wasm/ changed without the recipe',
      'hash moving, or the toolchain produced a different binary from the same',
      'source — and a build that differs for no reason is worth understanding',
      'before it is published.',
      '',
      'If you have looked and the difference is expected:',
      '',
      '  1. record it, so the next build is compared against this one:',
      `       node wasm/check-digest.mjs --record ${observed}`,
      '     and commit wasm/digests.json with whatever caused it;',
      '',
      '  2. or proceed without recording by re-running the WASM workflow with the',
      '     `allow_digest_drift` input set to true. That is visible in the run and',
      '     in the job log, and it does not change the recorded value.',
    ].join('\n'),
  )

  return process.env.WASM_DIGEST_ALLOW_DRIFT === 'true' ? 0 : 1
}

process.exitCode = main()
