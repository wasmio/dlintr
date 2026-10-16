/**
 * The WASI preview1 surface hadolint's reactor actually uses.
 *
 * Measured, not assumed: instrumenting every `wasi_snapshot_preview1` import
 * across the paths this package exercises (`version`, a clean lint, findings, an
 * unparseable Dockerfile and the `HADOLINT_TRUSTED_REGISTRIES` case) shows five
 * calls and fifteen declared-but-never-called imports. `wasm/calls.mjs`
 * regenerates that measurement, and is the thing to run when the submodule
 * moves — the surface is version-bound, and this file is only correct for the
 * build that was measured.
 *
 * The fifteen unimplemented imports are stubs that **throw by name**. That is
 * what makes this safe rather than merely small: a future module that reaches
 * for `fd_write` fails at `fd_write`, loudly and legibly, instead of silently
 * losing output.
 */

/** `clockid_t`. The RTS asks for the monotonic clock; anything else is a bug. */
const CLOCK_MONOTONIC = 1

/** WASI pointers are 32-bit, so a pointer table advances four bytes per entry. */
const POINTER_SIZE = 4

/** `performance.now()` is milliseconds; WASI wants nanoseconds. */
const NANOSECONDS_PER_MILLISECOND = 1e6

/** `errno`. The only one this shim ever returns. */
const ERRNO_SUCCESS = 0

/** The imports the reactor declares but no exercised path calls. */
const NOT_IMPLEMENTED = [
  'fd_close',
  'fd_fdstat_get',
  'fd_fdstat_set_flags',
  'fd_filestat_get',
  'fd_filestat_set_size',
  'fd_prestat_get',
  'fd_prestat_dir_name',
  'fd_read',
  'fd_seek',
  'fd_write',
  'path_create_directory',
  'path_filestat_get',
  'path_open',
  'poll_oneoff',
  'proc_exit',
] as const

/** What `initialize` needs from the instance. */
export interface WasiInstance {
  exports: {
    memory: WebAssembly.Memory
    _initialize?: () => unknown
  }
}

/** The host half of the reactor: an import namespace, and the entry point. */
export interface WasiHost {
  /** Handed to `WebAssembly.instantiate` as `wasi_snapshot_preview1`. */
  wasiImport: Record<string, WebAssembly.ExportValue>
  /** Sets the memory and calls the module's `_initialize`, exactly once. */
  initialize: (instance: WasiInstance) => void
}

/**
 * Build a WASI host for the given environment.
 *
 * @param env Environment as `KEY=value` pairs, as `environ_get` will report it.
 * @returns The import namespace and the initialiser.
 */
export const createWasiHost = (env: readonly string[]): WasiHost => {
  let memory: WebAssembly.Memory | undefined

  const requireMemory = (): WebAssembly.Memory => {
    if (!memory) {
      throw new Error('dlintr: WASI called before initialize()')
    }
    return memory
  }

  /** A fresh view each call: memory can grow and detach the old buffer. */
  const view = (): DataView => new DataView(requireMemory().buffer)

  const bytes = (): Uint8Array => new Uint8Array(requireMemory().buffer)

  const encoder = new TextEncoder()
  const entries = env.map(entry => encoder.encode(`${entry}\0`))

  // `args_*` are real but always empty: nothing passes argv to a reactor, and
  // the RTS calls both unconditionally during `_initialize`.
  const argsSizesGet = (countPointer: number, sizePointer: number): number => {
    const data = view()
    data.setUint32(countPointer, 0, true)
    data.setUint32(sizePointer, 0, true)
    return ERRNO_SUCCESS
  }

  const environSizesGet = (
    countPointer: number,
    sizePointer: number,
  ): number => {
    const data = view()
    data.setUint32(countPointer, entries.length, true)
    data.setUint32(
      sizePointer,
      entries.reduce((total, entry) => total + entry.length, 0),
      true,
    )
    return ERRNO_SUCCESS
  }

  const environGet = (pointerTable: number, buffer: number): number => {
    const data = view()
    const target = bytes()
    let offset = buffer
    for (const [index, entry] of entries.entries()) {
      data.setUint32(pointerTable + index * POINTER_SIZE, offset, true)
      target.set(entry, offset)
      offset += entry.length
    }
    return ERRNO_SUCCESS
  }

  // A genuine monotonic clock, not a counter or a constant: the findings path
  // calls this ~1,700 times, because it is the RTS timer and GC.
  const clockTimeGet = (
    id: number,
    _precision: bigint,
    timePointer: number,
  ): number => {
    if (id !== CLOCK_MONOTONIC) {
      throw new Error(
        `dlintr: clock_time_get(${id}) is not the monotonic clock`,
      )
    }
    const nanoseconds = BigInt(
      Math.round(performance.now() * NANOSECONDS_PER_MILLISECOND),
    )
    view().setBigUint64(timePointer, nanoseconds, true)
    return ERRNO_SUCCESS
  }

  const wasiImport: Record<string, WebAssembly.ExportValue> = {
    args_get: () => ERRNO_SUCCESS,
    args_sizes_get: argsSizesGet,
    clock_time_get: clockTimeGet,
    environ_get: environGet,
    environ_sizes_get: environSizesGet,
  }

  for (const name of NOT_IMPLEMENTED) {
    wasiImport[name] = () => {
      throw new Error(
        `dlintr: the reactor called \`${name}\`, which this WASI shim does not implement.\n` +
          `The imports actually used are measured, not assumed — run \`node wasm/calls.mjs\`\n` +
          `to see the current set. Seeing this means the module now reaches further than\n` +
          `when that measurement was taken, so implement \`${name}\` rather than retrying.`,
      )
    }
  }

  return {
    wasiImport,
    initialize: instance => {
      memory = instance.exports.memory
      instance.exports._initialize?.()
    },
  }
}
