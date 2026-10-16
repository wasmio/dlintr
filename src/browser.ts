/**
 * dlintr — browser entry point.
 *
 * Identical API to the Node entry. The difference is only how the two files are
 * obtained: this one fetches them next to the bundle. Bundlers targeting a
 * browser resolve this file automatically through the `browser` condition in
 * `package.json`.
 */
import { createDlinter } from './api.js'
import { memoize } from './memoize.js'
import { createReactor } from './reactor.js'
import type { GhcWasmJsffi } from './reactor.js'

/**
 * The module and its glue, fetched once. Only the WASI environment differs
 * between calls, and that is cheap to re-instantiate.
 */
const loadAssets = memoize(
  async (): Promise<readonly [WebAssembly.Module, GhcWasmJsffi]> => {
    const wasmUrl = new URL('../hadolint.wasm', import.meta.url)
    const glueUrl = new URL('../ghc_wasm_jsffi.js', import.meta.url)

    const [response, glue] = await Promise.all([
      fetch(wasmUrl),
      import(glueUrl.href) as Promise<{ default: GhcWasmJsffi }>,
    ])

    if (!response.ok) {
      throw new Error(
        `dlintr: could not fetch ${wasmUrl.pathname}: ${response.status} ${response.statusText}`,
      )
    }

    return [
      await WebAssembly.compile(await response.arrayBuffer()),
      glue.default,
    ] as const
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
