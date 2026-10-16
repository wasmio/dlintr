/**
 * Memoise an async load, without letting a rejection become permanent.
 *
 * Both entry points compile the module and its glue once and reuse them for the
 * life of the process; only the way the bytes arrive differs. The rule worth
 * sharing rather than copying is the second half: a failed load must **not** be
 * cached, or one transient read error would poison every later call. The cache
 * is therefore cleared when the load rejects, and only then.
 *
 * The handler is attached at the moment of loading rather than on every call,
 * so repeated calls add nothing.
 *
 * @param load Called at most once per successful cache lifetime.
 * @returns A loader that resolves to the first successful result.
 */
export const memoize = <T>(load: () => Promise<T>): (() => Promise<T>) => {
  let pending: Promise<T> | undefined

  return () => {
    pending ??= load()

    pending.catch(() => {
      pending = undefined
    })

    return pending
  }
}
