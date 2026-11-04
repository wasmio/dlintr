/**
 * Severity a rule can be raised at, ordered here alphabetically.
 *
 * hadolint escalates them as `style` < `info` < `warning` < `error`.
 */
export type Severity = 'error' | 'info' | 'style' | 'warning'

/** A single finding, as reported by hadolint's JSON formatter. */
export interface LintResult {
  /** Rule code, e.g. `DL3007`; `DL1000` means the Dockerfile could not be parsed. */
  code: string
  line: number
  column: number
  level: Severity
  message: string
  /** Filename echoed by hadolint; `-` because the content is passed directly. */
  file: string
}

/**
 * A label value type, as DL3050 and friends validate it.
 *
 * hadolint spells the raw-text one `text`, not `string`.
 */
export type LabelType =
  'email' | 'hash' | 'rfc3339' | 'semver' | 'spdx' | 'text' | 'url'

/**
 * Options for {@link Dlinter.lint}.
 *
 * Every field is also read from the matching `HADOLINT_*` variable in
 * `process.env` when it is not given here, so a Node host can configure the
 * linter once for the whole process; a browser has no `process` and inherits
 * nothing. An explicit field wins over the variable, including when it is empty:
 * `ignore: []` or `trustedRegistries: []` removes the setting rather than
 * writing an empty value, which hadolint would read as one unusable entry.
 */
export interface LintOptions {
  /** Rule codes to suppress, e.g. `['DL3007']`. `HADOLINT_IGNORE`. */
  ignore?: string[]
  /**
   * Re-level individual rules, e.g. `{ DL3007: 'error' }`.
   *
   * Applied to the returned findings. hadolint has no severity *filter*, and
   * there is no exit code to threshold any more, so to act on just the serious
   * findings, filter the results on `level`.
   */
  severityOverrides?: Partial<Record<string, Severity>>
  /**
   * Registries DL3026 accepts, e.g. `['docker.io']`.
   *
   * `HADOLINT_TRUSTED_REGISTRIES`. The rule only fires when this is set, so an
   * empty list and an absent one are the same thing.
   */
  trustedRegistries?: string[]
  /**
   * Labels the image must carry, e.g. `{ maintainer: 'text' }`.
   *
   * `HADOLINT_REQUIRE_LABELS`. Drives DL3049 and DL3050–DL3055.
   */
  requireLabels?: Record<string, LabelType>
  /**
   * Reject labels that are not in {@link requireLabels}. `HADOLINT_STRICT_LABELS`.
   *
   * DL3050, "superfluous label(s) present". With nothing in {@link requireLabels}
   * every label is superfluous, so this reports them all.
   *
   * Independent of the missing-label check: DL3049 reports required labels that
   * are absent, which this neither causes nor suppresses.
   */
  strictLabels?: boolean
  /** Ignore `# hadolint ignore=…` pragmas in the Dockerfile. `HADOLINT_DISABLE_IGNORE_PRAGMA`. */
  disableIgnorePragma?: boolean
}
