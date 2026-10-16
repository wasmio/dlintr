/**
 * Verifies that the built `hadolint` wasm module and its JSFFI glue are present.
 *
 * Both are build artifacts, not source, and neither is committed. This used to
 * fetch them from a GitHub release asset that `release.yml` attached; it no
 * longer does anything of the sort, because that machinery was buying a
 * guarantee nothing needed.
 *
 * The consumer guarantee comes from npm: a published tarball is content-addressed
 * and immutable per version, so what a consumer installs is what was published.
 * Origin is covered by the build provenance attestation the workflow emits:
 *
 *   gh attestation verify hadolint.wasm -R wasmio/dlintr
 *
 * What that machinery was *not* buying is reproducibility, and it could not:
 * two builds of identical inputs do not produce identical bytes (measured, and
 * reported upstream — see `wasm/upstream-report.md`). So a digest recorded here
 * could never be compared against a rebuild, which is why the digest gate is
 * gone rather than failing.
 *
 * What remains is a pre-flight check with a useful error. CI builds the module in
 * `wasm.yml` and hands it to each job as an artifact; the npm tarball carries it
 * to consumers. The only case with nothing on disk is a fresh local checkout,
 * and that gets instructions rather than a stack trace.
 *
 * Both files are required: the reactor's exports are unreachable without the
 * glue, so a checkout from before the reactor landed can hold `hadolint.wasm`
 * and no glue, and failing on the wasm alone would leave every call rejecting.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** The package root, one level above both `src/` and `lib/`. */
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

const artifacts = ['hadolint.wasm', 'ghc_wasm_jsffi.js']

const missing = artifacts.filter(name => !existsSync(path.join(root, name)))

if (missing.length > 0) {
  throw new Error(
    [
      `dlintr: missing build artifact${
        missing.length > 1 ? 's' : ''
      }: ${missing.join(', ')}`,
      '',
      'These are build artifacts, not source, so they are neither committed nor',
      'downloaded. CI compiles them in the `WASM` workflow and passes them to the',
      'job that needs them; the npm tarball carries them to consumers.',
      '',
      'To produce them locally:',
      '',
      '  git submodule update --init',
      '  source ~/.ghc-wasm/env          # or install it — see wasm/README.md',
      '  bash wasm/build-reactor.sh',
    ].join('\n'),
  )
}
