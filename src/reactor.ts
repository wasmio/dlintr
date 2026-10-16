/**
 * Hosting hadolint's GHC JSFFI reactor.
 *
 * The module is a *reactor*, not a command: it exports `_initialize`, `lint` and
 * `version`, and there is no `_start`. It is instantiated once and called
 * repeatedly, unlike the WASI command this replaces, whose instance was
 * single-use and had to be rebuilt for every run.
 *
 * Two things here are not obvious and both are load-bearing.
 */
import { createWasiHost } from './wasi.js'

/**
 * The glue `post-link.mjs` emits next to the wasm.
 *
 * A factory rather than an object: it needs the instance's exports to build its
 * callbacks. What it returns is one *namespace* of imports — the
 * `ghc_wasm_jsffi` module — not a whole import object.
 */
export type GhcWasmJsffi = (
  exports: WebAssembly.Exports,
) => Record<string, WebAssembly.ExportValue>

/** The callable surface, once instantiated. */
export interface Reactor {
  /** Dockerfile text in, findings JSON out. */
  lint: (dockerfile: string) => Promise<string>
  /** The version string, as the CLI's `--version` prints it. */
  version: () => Promise<string>
}

/** What the module is expected to export. */
interface ReactorExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory
  _initialize: () => void
  lint: (dockerfile: string) => Promise<string>
  version: () => Promise<string>
}

/**
 * Instantiate the reactor and return its callable exports.
 *
 * @param module A compiled reactor.
 * @param glue The glue module generated for it.
 * @param env Environment as `KEY=value` pairs. The reactor reads
 *   `HADOLINT_TRUSTED_REGISTRIES` and friends through WASI `environ_get`, so
 *   these reach it the same way a command's environment did.
 * @returns The reactor, initialised and ready to call.
 */
export const createReactor = async (
  module: WebAssembly.Module,
  glue: GhcWasmJsffi,
  env: readonly string[],
): Promise<Reactor> => {
  const names = WebAssembly.Module.exports(module).map(({ name }) => name)

  // A reactor and a command are initialised differently, and getting it wrong
  // produces a confusing trap rather than an error, so check the shape we are
  // about to assume instead of discovering it at the first call.
  if (!names.includes('_initialize') || names.includes('_start')) {
    throw new Error(
      `dlintr: expected a reactor exporting \`_initialize\` and no \`_start\`, got: ${names.join(', ')}`,
    )
  }

  const wasi = createWasiHost(env)

  // The glue needs the instance's exports, but its output is needed *to*
  // instantiate — circular. It resolves because every access to those exports
  // in the generated glue sits inside an arrow-function body, and so is
  // evaluated at call time rather than when the factory runs. Populating the
  // object after instantiation is therefore sound; upstream's own reference
  // sidesteps the same problem by instantiating the module twice, which this
  // avoids.
  const deferred: WebAssembly.Exports = {}

  const instance = await WebAssembly.instantiate(module, {
    ghc_wasm_jsffi: glue(deferred),
    wasi_snapshot_preview1: wasi.wasiImport,
  })

  Object.assign(deferred, instance.exports)

  // `lint` and `version` are Haskell `IO`, so each returns a Promise. Forgetting
  // `await` yields a Promise where a string is expected, and the failure is a
  // confusing one rather than an obvious one, so the tests assert it.
  const reactor = instance.exports as ReactorExports

  // Exactly once, before any other export. `node:wasi` cannot do this — its
  // `initialize` ends in `proc_exit(71)` and the RTS never starts, so this
  // module would answer every call with "RTS is not initialised". That is true
  // of upstream's published reactor too, not just this build.
  //
  // The shim wants `{ exports }`, and passing that shape rather than an
  // `Instance` is also where the `memory` and `_initialize` it relies on are
  // guaranteed to exist.
  wasi.initialize({ exports: reactor })

  return {
    lint: dockerfile => reactor.lint(dockerfile),
    version: () => reactor.version(),
  }
}
