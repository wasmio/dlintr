import type { Reactor } from './reactor.js'
import type { LabelType, LintOptions, LintResult, Severity } from './types.js'

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

/** `process.env` when this is Node, and nothing when it is not. */
const processEnvironment = (): Record<string, string | undefined> =>
  (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env ?? {}

/** The `HADOLINT_*` variables already set in `process.env`, if this is Node. */
const inherited = (): Array<[string, string]> =>
  Object.entries(processEnvironment()).filter(
    (entry): entry is [string, string] =>
      entry[0].startsWith('HADOLINT_') && entry[1] !== undefined,
  )

/**
 * A comma-separated variable, as hadolint reads it.
 *
 * Only `HADOLINT_IGNORE` needs this. The reactor applies it to the checks, but a
 * parse error is `DL1000`, which sits outside that list — so an inherited ignore
 * cannot suppress it unless the findings are filtered here too.
 */
const listFromEnv = (name: string): string[] =>
  (processEnvironment()[name] ?? '').split(',').filter(Boolean)

/** The types hadolint can read back out of `HADOLINT_REQUIRE_LABELS`. */
const LABEL_TYPES: ReadonlySet<string> = new Set<LabelType>([
  'email',
  'hash',
  'rfc3339',
  'semver',
  'spdx',
  'text',
  'url',
])

/**
 * Reject a `requireLabels` entry the `name:type` encoding cannot carry.
 *
 * hadolint splits the schema on commas and then on the first colon, so a name
 * holding either would quietly become two requirements, or one with a truncated
 * name. It also *drops* a requirement whose type it cannot read, so an unknown
 * type would silently stop the label being required at all.
 */
const checkLabel = (label: string, type: string): void => {
  if (label.includes(',') || label.includes(':')) {
    throw new TypeError(
      `dlintr: label name ${JSON.stringify(label)} cannot contain a comma or a colon`,
    )
  }
  if (!LABEL_TYPES.has(type)) {
    throw new TypeError(
      `dlintr: unknown label type ${JSON.stringify(type)} for ${JSON.stringify(label)}`,
    )
  }
}

/** Reject a registry the comma-separated encoding would split in two. */
const checkRegistry = (registry: string): void => {
  if (registry.includes(',')) {
    throw new TypeError(
      `dlintr: registry ${JSON.stringify(registry)} cannot contain a comma`,
    )
  }
}

/** The options that have a `HADOLINT_*` spelling. */
const explicit = (options: LintOptions): Array<[string, string]> => {
  const pairs: Array<[string, string]> = []

  if (options.trustedRegistries) {
    for (const registry of options.trustedRegistries) {
      checkRegistry(registry)
    }
    pairs.push([
      'HADOLINT_TRUSTED_REGISTRIES',
      options.trustedRegistries.join(','),
    ])
  }
  if (options.requireLabels) {
    const labels = Object.entries(options.requireLabels)
    for (const [label, type] of labels) {
      checkLabel(label, type)
    }
    pairs.push([
      'HADOLINT_REQUIRE_LABELS',
      labels.map(([label, type]) => `${label}:${type}`).join(','),
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
 * is empty. Empty removes the variable rather than writing an empty one: hadolint
 * reads `HADOLINT_TRUSTED_REGISTRIES=` as the single registry "", which matches
 * nothing, so a written empty value would invert what an empty list means.
 */
const environment = (options: LintOptions): readonly string[] => {
  // hadolint resolves its config through `getHomeDirectory`, and GHC's
  // implementation falls back to `getEffectiveUserID`, which wasip1 does not
  // provide. Without `HOME` the reactor dies before linting anything.
  const pairs = new Map<string, string>([['HOME', '/'], ...inherited()])

  // `ignore` and `severityOverrides` are applied to the findings in JS, so the
  // reactor must not also apply an inherited copy — the explicit option wins.
  if (options.ignore) {
    pairs.delete('HADOLINT_IGNORE')
  }
  if (options.severityOverrides) {
    for (const level of ['ERROR', 'WARNING', 'INFO', 'STYLE']) {
      pairs.delete(`HADOLINT_OVERRIDE_${level}`)
    }
  }

  for (const [key, value] of explicit(options)) {
    // An empty value is not the same as an absent one to hadolint: it reads
    // `HADOLINT_TRUSTED_REGISTRIES=` as the single registry "", which matches
    // nothing, and `HADOLINT_IGNORE=` as one unusable rule code. Removing the
    // key is what "unset" means, and it clears any inherited value for the
    // same reason.
    if (value === '') {
      pairs.delete(key)
    } else {
      pairs.set(key, value)
    }
  }

  return [...pairs].map(([key, value]) => `${key}=${value}`)
}

/** Wire the public API onto a concrete reactor. */
export const createDlinter = (load: LoadReactor): Dlinter => {
  // One reactor per distinct environment: WASI fixes it when the instance is
  // created, and the reactor reads `HADOLINT_*` from it at that moment.
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

      // A cached rejection would make one transient failure permanent, but only
      // delete this load's entry: a newer load can hold the key meanwhile.
      reactor.catch(() => {
        if (reactors.get(key) === reactor) {
          reactors.delete(key)
        }
      })
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

      // Filtering and relabelling happen here rather than in the reactor for one
      // reason: a parse error is reported as `DL1000` outside hadolint's check
      // list, so `HADOLINT_IGNORE` and `HADOLINT_OVERRIDE_*` cannot reach it.
      const ignored = new Set(options.ignore ?? listFromEnv('HADOLINT_IGNORE'))
      return findings
        .filter(({ code }) => !ignored.has(code))
        .map(finding => {
          const level: Severity | undefined =
            options.severityOverrides?.[finding.code]
          return level ? { ...finding, level } : finding
        })
    },

    getVersion: async (): Promise<string> => {
      const { version } = await instance({})
      return version()
    },
  }
}
