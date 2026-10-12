import type { WasiRuntime } from './runtime.js'
import type { LintOptions, LintResult, RunOptions, RunResult } from './types.js'

/** The public surface, independent of which WASI host is underneath. */
export interface Dlinter {
  /**
   * Run `hadolint` with raw CLI arguments.
   *
   * Only stdin is reachable: the module runs without a filesystem, so pass the
   * Dockerfile through {@link RunOptions.stdin} and `-` as the argument.
   */
  run: (args: string[], options?: RunOptions) => Promise<RunResult>
  /**
   * Lint Dockerfile content and resolve with the findings.
   *
   * An unparseable Dockerfile is not an exception: hadolint reports it as a
   * `DL1000` finding with `level: 'error'`.
   */
  lint: (dockerfile: string, options?: LintOptions) => Promise<LintResult[]>
  /** The bundled hadolint version, e.g. `Haskell Dockerfile Linter 3.0.0`. */
  getVersion: () => Promise<string>
}

/** Wire the public API onto a concrete WASI host. */
export const createDlinter = (runtime: WasiRuntime): Dlinter => {
  let version: Promise<string> | undefined

  return {
    run: runtime.run,

    lint: async (
      dockerfile: string,
      options: LintOptions = {},
    ): Promise<LintResult[]> => {
      const args = ['--format', 'json']
      for (const code of options.ignore ?? []) {
        args.push('--ignore', code)
      }
      for (const [code, level] of Object.entries(
        options.severityOverrides ?? {},
      )) {
        if (level) {
          args.push(`--${level}`, code)
        }
      }
      args.push('-')

      const { stdout, stderr } = await runtime.run(args, {
        stdin: dockerfile,
        env: options.env,
      })

      // A clean Dockerfile is `[]`, never empty, so silence means hadolint never
      // reached the linting stage — a rejected option, say. Reporting "no
      // findings" there would hide a broken invocation.
      if (!stdout) {
        if (stderr) {
          throw new Error(stderr.trim())
        }
        return []
      }
      return JSON.parse(stdout) as LintResult[]
    },

    getVersion: () =>
      (version ??= runtime
        .run(['--version'])
        .then(({ stdout }) => stdout.trim())
        .catch((error: unknown) => {
          // A cached rejection would make one transient failure permanent.
          version = undefined
          throw error
        })),
  }
}
