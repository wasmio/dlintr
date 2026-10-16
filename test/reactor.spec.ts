import {
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { WASI } from 'node:wasi'

import { createReactor } from '../src/reactor.js'
import type { GhcWasmJsffi, Reactor } from '../src/reactor.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const reactorWasm = path.join(root, 'hadolint.wasm')
const gluePath = path.join(root, 'ghc_wasm_jsffi.js')

/**
 * The command build from the *same* commit — the only reference worth comparing
 * against. A difference would mean this package had forked the JSON format, and
 * a stored fixture would freeze whatever the format happened to be the day it
 * was recorded.
 *
 * Building it means linking hadolint's whole dependency tree a second way, so it
 * is built in exactly one CI job — `Command reference and format check` — and
 * that job sets `DLINTR_REQUIRE_CLI`. Everywhere else the file is absent and this
 * test skips, deliberately and in the log: the module is host-independent, so
 * eleven more builds of it would buy eleven more copies of one piece of evidence.
 */
const cliWasm = path.join(root, 'hadolint-cli.wasm')

/**
 * A module that exports `_start` and so is a *command*, not a reactor. Built by
 * hand rather than pulled from a fixture: it only has to be valid enough to
 * compile, and `createReactor` rejects it on its exports before instantiating.
 */
/* eslint-disable @typescript-eslint/no-magic-numbers, unicorn-x/number-literal-case
   -- these are the literal bytes of a wasm module, and neither rule can say
   anything useful about them. */
const COMMAND_MODULE = new Uint8Array([
  0x00,
  0x61,
  0x73,
  0x6d,
  0x01,
  0x00,
  0x00,
  0x00, // magic, version
  0x01,
  0x04,
  0x01,
  0x60,
  0x00,
  0x00, // type: () -> ()
  0x03,
  0x02,
  0x01,
  0x00, // function: one, of type 0
  0x07,
  0x0a,
  0x01,
  0x06,
  0x5f,
  0x73,
  0x74,
  0x61,
  0x72,
  0x74,
  0x00,
  0x00, // export `_start`
  0x0a,
  0x04,
  0x01,
  0x02,
  0x00,
  0x0b, // code: one empty body
])
/* eslint-enable @typescript-eslint/no-magic-numbers, unicorn-x/number-literal-case */

const load = async (): Promise<Reactor> => {
  const [bytes, glue] = await Promise.all([
    readFile(reactorWasm),
    import(pathToFileURL(gluePath).href) as Promise<{ default: GhcWasmJsffi }>,
  ])
  return createReactor(await WebAssembly.compile(bytes), glue.default, [
    'HOME=/',
  ])
}

/** Run the command build with `-f json` and return exactly what it wrote. */
const runCli = async (dockerfile: string): Promise<string> => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dlintr-cli-'))
  try {
    const stdin = path.join(dir, 'Dockerfile')
    const stdout = path.join(dir, 'stdout.json')
    writeFileSync(stdin, dockerfile)

    const wasi = new WASI({
      version: 'preview1',
      args: ['hadolint', '--no-color', '--format', 'json', '-'],
      env: { HOME: '/' },
      stdin: openSync(stdin, 'r'),
      stdout: openSync(stdout, 'w'),
      stderr: openSync(path.join(dir, 'stderr'), 'w'),
      returnOnExit: true,
    })

    const module = await WebAssembly.compile(readFileSync(cliWasm))
    // Node types `node:wasi`'s `wasiImport` as
    // `{ [key: string]: (...args: Array<any>) => unknown }`, so its `any` is
    // inescapable here: annotating the binding narrows how it is *used*, but the
    // source type still carries it, and the assertion this config declines to
    // credit is exactly the double cast that would silence it. `node:wasi` is
    // only used by this helper, to run the command build for the format check;
    // the package itself no longer depends on a WASI implementation at all.
    // type-coverage:ignore-next-line
    const wasiImports: Record<string, WebAssembly.ExportValue> = wasi.wasiImport
    const instance = await WebAssembly.instantiate(module, {
      wasi_snapshot_preview1: wasiImports,
    })
    wasi.start(instance)

    return readFileSync(stdout, 'utf8')
  } finally {
    // Best effort. `wasi.start` closes the descriptors it was handed, but on
    // Windows the directory can still refuse to go with `ENOTEMPTY` while those
    // handles are released — which is timing-dependent, so Node 24 and 26 pass
    // on the same runner where 20 and 22 do not. A leftover temp directory is
    // not a reason to fail the check that ran.
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // The assertions above are the test; this is housekeeping.
    }
  }
}

// Calling `_initialize` on something that wants `_start`, or the reverse, ends
// in a trap rather than an error, so the shape is checked before instantiation.
test('refuses a command module, naming what it expected', async () => {
  const command = new WebAssembly.Module(COMMAND_MODULE)

  await expect(createReactor(command, () => ({}), [])).rejects.toThrow(
    /expected a reactor exporting `_initialize` and no `_start`/,
  )
})

// Both exports are Haskell `IO`, so both are Promises. Awaiting is easy to
// forget, and the failure that follows is a confusing one rather than an
// obvious one, so assert it rather than trusting the reader to remember.
test('both exports return Promises', async () => {
  const reactor = await load()

  const linted = reactor.lint('FROM ubuntu:latest\n')
  const versioned = reactor.version()

  expect(linted).toBeInstanceOf(Promise)
  expect(versioned).toBeInstanceOf(Promise)

  expect(await versioned).toMatch(/^Haskell Dockerfile Linter \d+\.\d+\.\d+$/)
  expect(JSON.parse(await linted)).toHaveLength(1)
})

test('emits exactly the bytes the CLI emits for the same input', async () => {
  // Read once and handle absence, rather than stat-then-read: the check and
  // the use cannot disagree if there is only one call.
  let cli: Buffer | undefined
  try {
    cli = readFileSync(cliWasm)
  } catch {
    cli = undefined
  }

  if (!cli) {
    if (process.env.DLINTR_REQUIRE_CLI) {
      throw new Error(
        `${path.basename(cliWasm)} is required here but missing. It is the command build from the same commit; the \`WASM\` workflow uploads it as the \`hadolint-cli\` artifact.`,
      )
    }
    console.warn(
      `dlintr: no ${path.basename(cliWasm)}, skipping the format check`,
    )
    return
  }

  const dockerfile = 'FROM ubuntu:latest\nRUN apt-get update\n'
  const reactor = await load()

  // Exact bytes, both sides raw: the claim being tested is that the JSON encoder
  // carried in this package is byte-for-byte the library's.
  expect(await reactor.lint(dockerfile)).toBe(await runCli(dockerfile))
})

test('reuses one instance across calls', async () => {
  const reactor = await load()

  const first = await reactor.lint('FROM alpine:3.20\n')
  const second = await reactor.lint('FROM alpine:3.20\n')

  expect(first).toBe('[]')
  expect(second).toBe(first)
})
