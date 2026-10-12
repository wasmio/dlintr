import { openSync, closeSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { devNull } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WASI } from 'node:wasi'

import { DEFAULT_ENV, HADOLINT } from './runtime.js'
import type { WasiRuntime } from './runtime.js'
import type { RunOptions, RunResult } from './types.js'

/**
 * The package root, one level above both `src/` and `lib/`, for the ESM and the
 * CommonJS build alike.
 *
 * The bundle `rollup` emits has no `import.meta` — it is stubbed out as `{}` — so
 * fall back to `__dirname`, which exists only there.
 */
const packageRoot = (): string =>
  typeof __dirname === 'string'
    ? path.join(__dirname, '..')
    : fileURLToPath(new URL('..', import.meta.url))

const wasmPath = (): string => path.join(packageRoot(), 'hadolint.wasm')

const encoder = new TextEncoder()
const decoder = new TextDecoder()

let compiled: Promise<WebAssembly.Module> | undefined

const load = (): Promise<WebAssembly.Module> => {
  compiled ??= readFile(wasmPath())
    .then(bytes => WebAssembly.compile(bytes))
    .catch((error: unknown) => {
      // A cached rejection would make one unreadable file permanent.
      compiled = undefined
      throw error
    })
  return compiled
}

/** A WASI `iovec` is `{ buf: u32, buf_len: u32 }`: 8 bytes, length second. */
const IOVEC_SIZE = 8
const IOVEC_LENGTH_OFFSET = 4

/** Where a patched `fd_write` accumulates what the module printed. */
interface Intercepted {
  stdout: string
  stderr: string
}

/**
 * Serve stdin from memory and capture stdout/stderr, instead of handing real
 * file descriptors to `node:wasi`.
 *
 * Two reasons not to use real descriptors. `wasi.start()` only accepts numeric
 * fds, so capturing output would mean a temporary file per run; and uvwasi
 * *closes* the descriptors it is given when the instance is torn down, which
 * would take the host process's own stdin with it — passing fd `0` works exactly
 * once, then the next `new WASI()` fails with `UVWASI_EBADF`.
 */
/** The WASI syscalls this module imports all take and return i32 values. */
type WasiImports = Record<string, (...args: number[]) => number>

const intercept = (
  imports: WasiImports,
  memory: () => ArrayBuffer,
  stdin: Uint8Array,
): Intercepted => {
  const state: Intercepted = { stdout: '', stderr: '' }
  let offset = 0

  const views = (): { view: DataView; bytes: Uint8Array } => {
    const buffer = memory()
    return { view: new DataView(buffer), bytes: new Uint8Array(buffer) }
  }

  /** Walk a WASI iovec array, yielding each `{ offset, length }` pair. */
  const iovecs = (
    iovs: number,
    iovsLen: number,
  ): Array<{ offset: number; length: number }> => {
    const { view } = views()
    const result: Array<{ offset: number; length: number }> = []
    for (let index = 0; index < iovsLen; index++) {
      result.push({
        offset: view.getUint32(iovs + index * IOVEC_SIZE, true),
        length: view.getUint32(
          iovs + index * IOVEC_SIZE + IOVEC_LENGTH_OFFSET,
          true,
        ),
      })
    }
    return result
  }

  imports.fd_read = (_fd, iovs, iovsLen, nreadPtr) => {
    const { view, bytes } = views()
    let read = 0
    for (const { offset: target, length } of iovecs(iovs, iovsLen)) {
      const size = Math.min(length, stdin.length - offset)
      if (size <= 0) {
        break
      }
      bytes.set(stdin.subarray(offset, offset + size), target)
      offset += size
      read += size
    }
    // A zero-length read is how WASI reports end of input.
    view.setUint32(nreadPtr, read, true)
    return 0
  }

  imports.fd_write = (fd, iovs, iovsLen, nwrittenPtr) => {
    const { view, bytes } = views()
    let written = 0
    for (const { offset: source, length } of iovecs(iovs, iovsLen)) {
      const chunk = decoder.decode(bytes.subarray(source, source + length))
      if (fd === 1) {
        state.stdout += chunk
      } else if (fd === 2) {
        state.stderr += chunk
      }
      written += length
    }
    view.setUint32(nwrittenPtr, written, true)
    return 0
  }

  return state
}

/** Reach the module's linear memory; `_start` cannot run before it exists. */
const memoryOf = (instance: WebAssembly.Instance): ArrayBuffer =>
  (instance.exports as { memory: WebAssembly.Memory }).memory.buffer

/** The descriptors handed to `node:wasi`, thrown away once a run finishes. */
interface Stdio {
  stdin: number
  stdout: number
  stderr: number
}

/** Open throwaway descriptors, so uvwasi never closes one belonging to the host. */
const openStdio = (): Stdio => ({
  stdin: openSync(devNull, 'r'),
  stdout: openSync(devNull, 'w'),
  stderr: openSync(devNull, 'w'),
})

/** uvwasi tears down the descriptors it was handed, so a double close is normal. */
const closeQuietly = (fd: number): void => {
  try {
    closeSync(fd)
  } catch {
    // already closed by uvwasi
  }
}

const closeStdio = (stdio: Stdio): void => {
  closeQuietly(stdio.stdin)
  closeQuietly(stdio.stdout)
  closeQuietly(stdio.stderr)
}

/** Build the runtime backed by Node's built-in WASI implementation. */
export const createNodeRuntime = (): WasiRuntime => ({
  run: async (args: string[], options: RunOptions = {}): Promise<RunResult> => {
    const module = await load()
    const stdio = openStdio()
    let instance: WebAssembly.Instance | undefined
    try {
      const wasi = new WASI({
        version: 'preview1',
        args: [HADOLINT, ...args],
        env: { ...DEFAULT_ENV, ...options.env },
        stdin: stdio.stdin,
        stdout: stdio.stdout,
        stderr: stdio.stderr,
      })

      // `@types/node` types the members of `wasiImport` as `any`, so go through a
      // shape of our own to keep the surface fully typed. It stays a single
      // object: `start` is a prototype method and needs its receiver.
      const nodeWasi = wasi as unknown as {
        start: (instance: WebAssembly.Instance) => number | undefined
        wasiImport: WasiImports
      }

      const intercepted = intercept(
        nodeWasi.wasiImport,
        () => {
          if (!instance) {
            throw new Error(
              'dlintr: hadolint touched stdio before it was instantiated',
            )
          }
          return memoryOf(instance)
        },
        encoder.encode(options.stdin ?? ''),
      )

      // Built by hand rather than through `wasi.getImportObject()`, so the
      // patched `fd_read` / `fd_write` are the ones the module is handed.
      instance = await WebAssembly.instantiate(module, {
        wasi_snapshot_preview1: nodeWasi.wasiImport,
      })
      // `returnOnExit` defaults to true, so `start()` yields the status code
      // instead of terminating the host process.
      const exitCode = nodeWasi.start(instance)

      return { exitCode: exitCode ?? 0, ...intercepted }
    } finally {
      closeStdio(stdio)
    }
  },
})
