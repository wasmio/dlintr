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

/** The `HADOLINT_*` variables already set in `process.env`, if this is Node. */
const inherited = (): Array<[string, string]> => {
  const env = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process?.env

  return Object.entries(env ?? {}).filter(
    (entry): entry is [string, string] =>
      entry[0].startsWith('HADOLINT_') && entry[1] !== undefined,
  )
}

/** Severity overrides, grouped into the four variables hadolint reads. */
const overrides = (
  byRule: Partial<Record<string, Severity>>,
): Array<[string, string]> => {
  const byLevel: Record<Severity, string[]> = {
    error: [],
    info: [],
    style: [],
    warning: [],
  }

  for (const [code, level] of Object.entries(byRule)) {
    // `Partial`, so a key may be present with no level; skip it rather than
    // widening the type.
    if (level) {
      byLevel[level].push(code)
    }
  }

  return Object.entries(byLevel).map(([level, codes]) => [
    `HADOLINT_OVERRIDE_${level.toUpperCase()}`,
    codes.join(','),
  ])
}

/** The options that have a `HADOLINT_*` spelling. */
const explicit = (options: LintOptions): Array<[string, string]> => {
  const pairs: Array<[string, string]> = []

  if (options.ignore) {
    pairs.push(['HADOLINT_IGNORE', options.ignore.join(',')])
  }
  if (options.severityOverrides) {
    pairs.push(...overrides(options.severityOverrides))
  }
  if (options.trustedRegistries) {
    pairs.push([
      'HADOLINT_TRUSTED_REGISTRIES',
      options.trustedRegistries.join(','),
    ])
  }
  if (options.requireLabels) {
    for (const label of Object.keys(options.requireLabels)) {
      // hadolint splits the schema on commas and then on the first colon, so a
      // name holding either would quietly become two requirements, or one with
      // a truncated name. Say so here instead.
      if (label.includes(',') || label.includes(':')) {
        throw new TypeError(
          `dlintr: label name ${JSON.stringify(label)} cannot contain a comma or a colon`,
        )
      }
    }
    pairs.push([
      'HADOLINT_REQUIRE_LABELS',
      Object.entries(options.requireLabels)
        .map(([label, type]) => `${label}:${type}`)
        .join(','),
    ])
  }
  if (options.strictLabels !== undefined) {
    pairs.push(['HADOLINT_STRICT_LABELS', options.strictLabels ? '1' : ''])
  }
  if (options.disableIgnorePragma !== undefined) {
    pairs.push([
      'HADOLINT_DISABLE_IGNORE_PRAGMA',
      options.disableIgnorePragma ? '1' : '',
    ])
  }

  return pairs
}

/**
 * The environment hadolint reads, as `KEY=value` pairs.
 *
 * Every option is spelled as the `HADOLINT_*` variable it stands for, so there is
 * one path rather than two: a Node host gets its `process.env` for free —
 * configure `HADOLINT_TRUSTED_REGISTRIES` once and every call sees it — while a
 * browser has no `process` and simply has nothing to inherit.
 *
 * An explicit option wins over the variable it corresponds to, including when it
 * is empty. `ignore: []` writes an empty `HADOLINT_IGNORE`, which hadolint reads
 * as a list holding one unusable code, so nothing is ignored — the inherited
 * value is cleared rather than merely added to.
 */
const environment = (options: LintOptions): readonly string[] => {
  // hadolint resolves its config through `getHomeDirectory`, and GHC's
  // implementation falls back to `getEffectiveUserID`, which wasip1 does not
  // provide. Without `HOME` the reactor dies before linting anything.
  const pairs = new Map<string, string>([
    ['HOME', '/'],
    ...inherited(),
    ...explicit(options),
  ])

  return [...pairs].map(([key, value]) => `${key}=${value}`)
}

/**
 * How many reactors to keep. Each is a WebAssembly instance over a 7.6 MiB
 * module, and the cache key is the whole environment, so an app that varies
 * `ignore` or `trustedRegistries` per call would otherwise hold one instance per
 * distinct combination for the life of the process.
 */
const MAX_REACTORS = 8

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

      // A `Map` iterates in insertion order, so the first key is the oldest —
      // never this one, which was just appended.
      if (reactors.size > MAX_REACTORS) {
        const oldest = reactors.keys().next()
        if (!oldest.done) {
          reactors.delete(oldest.value)
        }
      }
    }
    return reactor
  }

  return {
    lint: async (
      dockerfile: string,
      options: LintOptions = {},
    ): Promise<LintResult[]> => {
      const { lint } = await instance(options)
      // `ignore` and `severityOverrides` travel as `HADOLINT_IGNORE` and
      // `HADOLINT_OVERRIDE_*`, so the reactor has already filtered and
      // relabelled these; parsing is all that is left.
      return JSON.parse(await lint(dockerfile)) as LintResult[]
    },

    getVersion: async (): Promise<string> => {
      const { version } = await instance({})
      return version()
    },
  }
}
