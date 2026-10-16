/**
 * Memoise an async load, without letting a rejection become permanent.
 *
 * Both entry points compile the module and its glue once and reuse them for the
 * life of the process; only the way the bytes arrive differs. The rule worth
 * sharing rather than copying is the second half: a failed load must **not** be
 * cached, or one transient read error would poison every later call. The cache
 * is therefore cleared when the load rejects, and only then.
 *
 * @param load Called at most once per successful cache lifetime.
 * @returns A loader that resolves to the first successful result.
 */
export const memoize = <T>(load: () => Promise<T>): (() => Promise<T>) => {
  let pending: Promise<T> | undefined

  return () => {
    if (!pending) {
      const started = load()

      // Attached where the load starts, not on every call. Nothing guards the
      // clearing below, and nothing needs to: `pending` is only assigned here,
      // inside `!pending`, so while a promise is pending it cannot be replaced
      // — and only that promise's own rejection can clear it.
      started.catch(() => {
        pending = undefined
      })

      pending = started
    }

    return pending
  }
}
