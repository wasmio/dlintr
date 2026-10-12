/**
 * Severity a rule can be raised at, ordered here alphabetically.
 *
 * hadolint escalates them as `style` < `info` < `warning` < `error`.
 */
export type Severity = 'error' | 'info' | 'style' | 'warning'

/** Every output format `hadolint` can emit. */
export type OutputFormat =
  | 'checkstyle'
  | 'codacy'
  | 'codeclimate'
  | 'gitlab_codeclimate'
  | 'gnu'
  | 'json'
  | 'sarif'
  | 'sonarqube'
  | 'tty'

/** A single finding, as reported by `hadolint --format json`. */
export interface LintResult {
  /** Rule code, e.g. `DL3007`; `DL1000` means the Dockerfile could not be parsed. */
  code: string
  line: number
  column: number
  level: Severity
  message: string
  /** Filename echoed by hadolint; `-` when the content came from stdin. */
  file: string
}

/** Result of a raw `hadolint` invocation. */
export interface RunResult {
  exitCode: number
  stdout: string
  stderr: string
}

/** Options for {@link Dlinter.run}. */
export interface RunOptions {
  /**
   * Dockerfile content handed to hadolint over stdin. Use `-` in `args` to have
   * hadolint read it.
   */
  stdin?: string
  /**
   * Extra environment variables for hadolint. Note that hadolint reads `HOME`
   * while looking for a config file, so it is always supplied.
   */
  env?: Record<string, string>
}

/** Options for {@link Dlinter.lint}. */
export interface LintOptions {
  /** Rule codes to suppress, e.g. `['DL3007']`. */
  ignore?: string[]
  /**
   * Re-level individual rules, e.g. `{ DL3007: 'error' }`.
   *
   * hadolint has no severity *filter* — `--failure-threshold` only changes the
   * exit code, which {@link Dlinter.lint} does not report. To act on just the
   * serious findings, filter the returned results on `level`.
   */
  severityOverrides?: Partial<Record<string, Severity>>
  /** Extra environment variables; `HADOLINT_IGNORE` and friends also work. */
  env?: Record<string, string>
}
