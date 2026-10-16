import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { createReactor } from '../src/reactor.js'
import type { GhcWasmJsffi, Reactor } from '../src/reactor.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const reactorWasm = path.join(root, 'hadolint.wasm')
const gluePath = path.join(root, 'ghc_wasm_jsffi.js')

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

test('reuses one instance across calls', async () => {
  const reactor = await load()

  const first = await reactor.lint('FROM alpine:3.20\n')
  const second = await reactor.lint('FROM alpine:3.20\n')

  expect(first).toBe('[]')
  expect(second).toBe(first)
})
