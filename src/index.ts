/**
 * dlintr — Dockerfile linter, powered by hadolint compiled to WASM.
 *
 * This is the Node entry point; it drives the module with the built-in
 * `node:wasi`. Bundlers targeting a browser resolve the `browser` condition and
 * pick up `browser.ts` instead.
 */
import { createDlinter } from './api.js'
import { createNodeRuntime } from './wasi-node.js'

const dlinter = createDlinter(createNodeRuntime())

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
