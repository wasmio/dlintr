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

/** Options for {@link Dlinter.lint}. */
export interface LintOptions {
  /** Rule codes to suppress, e.g. `['DL3007']`. */
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
   * Extra environment variables for hadolint, e.g.
   * `{ HADOLINT_TRUSTED_REGISTRIES: 'docker.io' }`.
   *
   * These reach the module through WASI, so changing them re-instantiates the
   * reactor — which is cheap, but not free, so pass a stable set rather than
   * varying it per call.
   */
  env?: Record<string, string>
}
