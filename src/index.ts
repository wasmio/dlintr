/**
 * dlintr — Dockerfile linter, powered by hadolint compiled to WASM.
 *
 * This is the Node entry point. It hosts hadolint's GHC JSFFI reactor, which is
 * instantiated once and called — `lint(text)` in, findings JSON out — rather
 * than a process fed stdin. Bundlers targeting a browser resolve the `browser`
 * condition and pick up `browser.ts`, which loads the same two files over HTTP
 * and is otherwise identical.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { createDlinter } from './api.js'
import { memoize } from './memoize.js'
import { createReactor } from './reactor.js'
import type { GhcWasmJsffi } from './reactor.js'

/**
 * The package root, one level above both `src/` and `lib/`, for the ESM and the
 * CommonJS build alike.
 *
 * The bundle `rollup` emits has no `import.meta` — it is stubbed out as `{}` —
 * so fall back to `__dirname`, which exists only there.
 */
const packageRoot = (): string =>
  typeof __dirname === 'string'
    ? path.join(__dirname, '..')
    : fileURLToPath(new URL('..', import.meta.url))

/**
 * The module and its glue, compiled once. Only the WASI environment differs
 * between calls, and that is cheap to re-instantiate.
 */
const loadAssets = memoize(
  async (): Promise<readonly [WebAssembly.Module, GhcWasmJsffi]> => {
    const root = packageRoot()
    const [bytes, glue] = await Promise.all([
      readFile(path.join(root, 'hadolint.wasm')),
      import(
        pathToFileURL(path.join(root, 'ghc_wasm_jsffi.js')).href
      ) as Promise<{
        default: GhcWasmJsffi
      }>,
    ])
    return [await WebAssembly.compile(bytes), glue.default] as const
  },
)

const dlinter = createDlinter(async env => {
  const [module, glue] = await loadAssets()
  return createReactor(module, glue, env)
})

export const lint = dlinter.lint
export const getVersion = dlinter.getVersion

export type { Dlinter, LoadReactor } from './api.js'
export type { Reactor } from './reactor.js'
export type { LintOptions, LintResult, Severity } from './types.js'
