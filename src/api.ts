import type { Reactor } from './reactor.js'
import type { LintOptions, LintResult, Severity } from './types.js'

/** The public surface, independent of which host is underneath. */
export interface Dlinter {
  /**
   * Lint Dockerfile content and resolve with the findings.
   *
   * An unparseable Dockerfile is not an exception: hadolint reports it as a
   * `DL1000` finding with `level: 'error'`.
   */
  lint: (dockerfile: string, options?: LintOptions) => Promise<LintResult[]>
  /** The bundled hadolint version, e.g. `Haskell Dockerfile Linter 2.15.1`. */
  getVersion: () => Promise<string>
}

/**
 * Build a reactor for an environment, given as `KEY=value` pairs.
 *
 * Instantiation is per environment rather than per call, because WASI fixes the
 * environment when the instance is created: the reactor reads
 * `HADOLINT_TRUSTED_REGISTRIES` through `environ_get`, so a different
 * environment has to be a different instance.
 */
export type LoadReactor = (env: readonly string[]) => Promise<Reactor>

/**
 * hadolint resolves its config through `getHomeDirectory`, and GHC's
 * implementation falls back to `getEffectiveUserID`, which wasip1 does not
 * provide. Without `HOME` the reactor dies before linting anything.
 */
const HOME = 'HOME=/'

/** Wire the public API onto a concrete reactor. */
export const createDlinter = (load: LoadReactor): Dlinter => {
  const reactors = new Map<string, Promise<Reactor>>()

  const instance = (env?: Record<string, string>): Promise<Reactor> => {
    const pairs = [
      HOME,
      ...Object.entries(env ?? {}).map(([key, value]) => `${key}=${value}`),
    ]
    const key = pairs.join('\n')

    let reactor = reactors.get(key)
    if (!reactor) {
      reactor = load(pairs)
      reactors.set(key, reactor)
      // A cached rejection would make one transient failure permanent.
      reactor.catch(() => reactors.delete(key))
    }
    return reactor
  }

  return {
    lint: async (
      dockerfile: string,
      options: LintOptions = {},
    ): Promise<LintResult[]> => {
      const { lint } = await instance(options.env)
      const findings = JSON.parse(await lint(dockerfile)) as LintResult[]

      // `--ignore` and `--error`/`--warning`/… used to be CLI arguments. The
      // reactor's `lint` takes only the Dockerfile, so both are applied here.
      // Neither needs the Haskell side — they are filtering and relabelling —
      // so neither is lost along with the argument surface.
      const ignored = new Set(options.ignore ?? [])
      return findings
        .filter(({ code }) => !ignored.has(code))
        .map(({ code, ...rest }) => {
          const level: Severity | undefined = options.severityOverrides?.[code]
          return level ? { code, ...rest, level } : { code, ...rest }
        })
    },

    getVersion: async (): Promise<string> => {
      const { version } = await instance()
      return version()
    },
  }
}
