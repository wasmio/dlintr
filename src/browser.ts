/**
 * dlintr — browser entry point.
 *
 * Identical API to the Node entry, but the module is driven by
 * `@bjorn3/browser_wasi_shim` (~29 kB minified) instead of `node:wasi`. Install
 * it alongside dlintr; it is an optional peer dependency so Node users never pay
 * for it.
 *
 * Bundlers targeting a browser resolve this file automatically through the
 * `browser` condition in `package.json`.
 */
import { createDlinter } from './api.js'
import { createBrowserRuntime } from './wasi-browser.js'

const dlinter = createDlinter(createBrowserRuntime())

export const run = dlinter.run
export const lint = dlinter.lint
export const getVersion = dlinter.getVersion

export type { Dlinter } from './api.js'
export type { WasiRuntime } from './runtime.js'
export type {
  LintOptions,
  LintResult,
  OutputFormat,
  RunOptions,
  RunResult,
  Severity,
} from './types.js'
