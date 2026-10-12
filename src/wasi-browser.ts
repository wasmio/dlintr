import { ConsoleStdout, File, OpenFile, WASI } from '@bjorn3/browser_wasi_shim'

import { DEFAULT_ENV, HADOLINT } from './runtime.js'
import type { WasiRuntime } from './runtime.js'
import type { RunOptions, RunResult } from './types.js'

const WASM_URL = new URL('../hadolint.wasm', import.meta.url)

const encoder = new TextEncoder()

/** The shape `browser_wasi_shim`'s `start` requires of an instantiated module. */
interface CommandInstance {
  exports: { memory: WebAssembly.Memory; _start: () => unknown }
}

let compiled: Promise<WebAssembly.Module> | undefined

/** `fetch` resolves on an error status, so check it before compiling the body. */
const load = (): Promise<WebAssembly.Module> => {
  compiled ??= fetch(WASM_URL)
    .then(response => {
      if (!response.ok) {
        throw new Error(
          `failed to fetch ${WASM_URL.pathname}: ${response.status} ${response.statusText}`,
        )
      }
      return response.arrayBuffer()
    })
    .then(buffer => WebAssembly.compile(buffer))
    .catch((error: unknown) => {
      // A cached rejection would make one bad fetch permanent.
      compiled = undefined
      throw error
    })
  return compiled
}

export const createBrowserRuntime = (): WasiRuntime => ({
  run: async (args: string[], options: RunOptions = {}): Promise<RunResult> => {
    const module = await load()

    let stdout = ''
    let stderr = ''
    // Separate decoders, so a multi-byte character split across two writes is
    // not stitched together from the wrong stream.
    const outDecoder = new TextDecoder()
    const errDecoder = new TextDecoder()

    const fds = [
      new OpenFile(new File(encoder.encode(options.stdin ?? ''))),
      new ConsoleStdout(buffer => {
        stdout += outDecoder.decode(buffer, { stream: true })
      }),
      new ConsoleStdout(buffer => {
        stderr += errDecoder.decode(buffer, { stream: true })
      }),
    ]

    const env = Object.entries({ ...DEFAULT_ENV, ...options.env }).map(
      ([key, value]) => `${key}=${value}`,
    )

    // `debug` must be passed explicitly: the shim turns verbose logging on when
    // the option is merely absent.
    const wasi = new WASI([HADOLINT, ...args], env, fds, { debug: false })
    const instance = (await WebAssembly.instantiate(module, {
      wasi_snapshot_preview1: wasi.wasiImport,
    })) as unknown as CommandInstance
    const exitCode = wasi.start(instance)

    stdout += outDecoder.decode()
    stderr += errDecoder.decode()

    return { exitCode, stdout, stderr }
  },
})
