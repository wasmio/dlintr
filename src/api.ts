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
 * The environment hadolint reads, as `KEY=value` pairs.
 *
 * Each option is also spelled as the `HADOLINT_*` variable it stands for, so one
 * path carries both. A Node host gets its `process.env` for free — configure
 * `HADOLINT_TRUSTED_REGISTRIES` once and every call sees it — while a browser
 * has no `process` and simply has nothing to inherit. An explicit option wins
 * over the variable it corresponds to.
 *
 * The four below reach the reactor because they change what the *rules* do;
 * `ignore` and `severityOverrides` do not need it, since they filter and
 * relabel findings that are already computed.
 */
const environment = (options: LintOptions): readonly string[] => {
  // hadolint resolves its config through `getHomeDirectory`, and GHC's
  // implementation falls back to `getEffectiveUserID`, which wasip1 does not
  // provide. Without `HOME` the reactor dies before linting anything.
  const pairs = new Map<string, string>([['HOME', '/']])

  const processEnv = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process?.env

  for (const [key, value] of Object.entries(processEnv ?? {})) {
    if (key.startsWith('HADOLINT_') && value !== undefined) {
      pairs.set(key, value)
    }
  }

  if (options.trustedRegistries) {
    pairs.set(
      'HADOLINT_TRUSTED_REGISTRIES',
      options.trustedRegistries.join(','),
    )
  }
  if (options.requireLabels) {
    pairs.set(
      'HADOLINT_REQUIRE_LABELS',
      Object.entries(options.requireLabels)
        .map(([label, type]) => `${label}:${type}`)
        .join(','),
    )
  }
  if (options.strictLabels !== undefined) {
    pairs.set('HADOLINT_STRICT_LABELS', options.strictLabels ? '1' : '')
  }
  if (options.disableIgnorePragma !== undefined) {
    pairs.set(
      'HADOLINT_DISABLE_IGNORE_PRAGMA',
      options.disableIgnorePragma ? '1' : '',
    )
  }

  return [...pairs].map(([key, value]) => `${key}=${value}`)
}

/** Wire the public API onto a concrete reactor. */
export const createDlinter = (load: LoadReactor): Dlinter => {
  const reactors = new Map<string, Promise<Reactor>>()

  const instance = (options: LintOptions): Promise<Reactor> => {
    const pairs = environment(options)
    // `JSON.stringify` rather than a join: exact even when a value contains the
    // separator, which an environment variable may.
    const key = JSON.stringify(pairs)

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
      const { lint } = await instance(options)
      const findings = JSON.parse(await lint(dockerfile)) as LintResult[]

      // `--ignore` and `--error`/`--warning`/… used to be CLI arguments. The
      // reactor's `lint` takes only the Dockerfile, so both are applied here.
      // Neither needs the Haskell side — they are filtering and relabelling —
      // so neither is lost along with the argument surface.
      const ignored = new Set(options.ignore ?? [])
      return findings
        .filter(({ code }) => !ignored.has(code))
        .map(finding => {
          const level: Severity | undefined =
            options.severityOverrides?.[finding.code]
          // Only re-level when there is an override, so the common case does
          // not rebuild every finding: `level` keeps its position either way.
          return level ? { ...finding, level } : finding
        })
    },

    getVersion: async (): Promise<string> => {
      const { version } = await instance({})
      return version()
    },
  }
}
