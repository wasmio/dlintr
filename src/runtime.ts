import type { RunOptions, RunResult } from './types.js'

/**
 * A WASI host able to execute the bundled `hadolint` command module.
 *
 * The module is a plain WASI preview1 *command*: it imports
 * `wasi_snapshot_preview1` and exports nothing but `memory` and `_start`, so an
 * instance is single-use and has to be re-instantiated for every run.
 */
export interface WasiRuntime {
  /** Run `hadolint` with `args`, resolving with its output and exit status. */
  run: (args: string[], options?: RunOptions) => Promise<RunResult>
}

/** `argv[0]` handed to hadolint, which it uses as the prefix of its own errors. */
export const HADOLINT = 'hadolint'

/**
 * hadolint resolves its config through `getHomeDirectory`, and GHC's
 * implementation falls back to `getEffectiveUserID` — a syscall wasip1 does not
 * provide. Without `HOME` in the environment the module dies before linting
 * anything, with `getXdgDirectory:getHomeDirectory:getEffectiveUserID`.
 */
export const DEFAULT_ENV: Readonly<Record<string, string>> = { HOME: '/' }
