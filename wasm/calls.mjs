/**
 * What does the reactor actually call on `wasi_snapshot_preview1`?
 *
 * The module *declares* twenty imports. That table is not the answer to "what
 * must a shim implement" — this is. It wraps every import, counts what the
 * reactor *does* call on the paths this package exercises, and names the ones it
 * never touches.
 *
 * Run it when the hadolint submodule or the wasm recipe moves. `src/wasi.ts`
 * implements a measured set and throws by name on everything else, so a surface
 * that has grown shows up as a failing test rather than as silence — but this is
 * what tells you the surface grew, and what to implement.
 *
 *   node wasm/calls.mjs [path/to/hadolint.wasm]
 *
 * The host here is deliberately its own small implementation rather than the
 * shipped one: an instrument that shares code with the thing it measures cannot
 * be trusted to notice when that thing is wrong.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const wasm = process.argv[2] ?? path.join(root, 'hadolint.wasm')
const gluePath = path.join(root, 'ghc_wasm_jsffi.js')

const REGISTRY = 'FROM myregistry.example.com/team/image:1.0\n'

/** WASI pointers are 32-bit, so a pointer table advances four bytes per entry. */
const POINTER_SIZE = 4
/** `performance.now()` is milliseconds; WASI wants nanoseconds. */
const NANOSECONDS_PER_MILLISECOND = 1e6
/** Column widths for the report, not quantities anything depends on. */
const NAME_WIDTH_FLOOR = 8
const CELL_WIDTH = 16

const scenarios = [
  ['version', [], 'FROM alpine:3.20\n', 'version'],
  ['lint clean', [], 'FROM alpine:3.20\n', 'lint'],
  ['lint findings', [], 'FROM ubuntu:latest\nRUN apt-get update\n', 'lint'],
  ['lint unparseable', [], 'NOT A DOCKERFILE\n', 'lint'],
  ['lint DL3026', ['HADOLINT_TRUSTED_REGISTRIES=docker.io'], REGISTRY, 'lint'],
]

/**
 * A minimal, counting WASI host.
 *
 * @param {string[]} env Environment as `KEY=value` pairs.
 * @returns {{
 *   wasiImport: Record<string, unknown>
 *   initialize: (instance: object) => void
 *   counts: Map<string, number>
 * }}
 */
const countingHost = env => {
  /** @type {Map<string, number>} */
  const counts = new Map()
  /** @type {WebAssembly.Memory | undefined} */
  let memory
  const encoder = new TextEncoder()
  const entries = env.map(entry => encoder.encode(`${entry}\0`))
  /** @returns {DataView} */
  const view = () => new DataView(memory.buffer)

  /** @param {string} name */
  const record = name => {
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }

  const implemented = {
    args_get: () => 0,
    args_sizes_get: (countPointer, sizePointer) => {
      view().setUint32(countPointer, 0, true)
      view().setUint32(sizePointer, 0, true)
      return 0
    },
    clock_time_get: (_id, _precision, timePointer) => {
      view().setBigUint64(
        timePointer,
        BigInt(Math.round(performance.now() * NANOSECONDS_PER_MILLISECOND)),
        true,
      )
      return 0
    },
    environ_get: (pointerTable, buffer) => {
      const data = view()
      const target = new Uint8Array(data.buffer)
      let offset = buffer
      for (const [index, entry] of entries.entries()) {
        data.setUint32(pointerTable + index * POINTER_SIZE, offset, true)
        target.set(entry, offset)
        offset += entry.length
      }
      return 0
    },
    environ_sizes_get: (countPointer, sizePointer) => {
      view().setUint32(countPointer, entries.length, true)
      view().setUint32(
        sizePointer,
        entries.reduce((total, entry) => total + entry.length, 0),
        true,
      )
      return 0
    },
  }

  const wasiImport = {}
  for (const [name, fn] of Object.entries(implemented)) {
    wasiImport[name] = (...args) => {
      record(name)
      return fn(...args)
    }
  }

  return {
    wasiImport,
    counts,
    initialize: instance => {
      memory = instance.exports.memory
      instance.exports._initialize?.()
    },
  }
}

const { default: glue } = await import(gluePath)
const module = await WebAssembly.compile(readFileSync(wasm))

const declared = new Set(
  WebAssembly.Module.imports(module)
    .filter(entry => entry.module === 'wasi_snapshot_preview1')
    .map(entry => entry.name),
)

// Every declared import is provided, so instantiation succeeds and any call is
// counted. An unimplemented one records a call and throws, which is a result.
const results = []
for (const [label, env, dockerfile, call] of scenarios) {
  const host = countingHost(['HOME=/', ...env])
  for (const name of declared) {
    host.wasiImport[name] ??= () => {
      host.counts.set(name, (host.counts.get(name) ?? 0) + 1)
      throw new Error(`${label}: called unimplemented ${name}`)
    }
  }

  const deferred = {}
  const instance = await WebAssembly.instantiate(module, {
    ghc_wasm_jsffi: glue(deferred),
    wasi_snapshot_preview1: host.wasiImport,
  })
  Object.assign(deferred, instance.exports)

  host.initialize(instance)
  const afterInitialize = new Map(host.counts)

  await (call === 'version'
    ? instance.exports.version()
    : instance.exports.lint(dockerfile))

  results.push({ afterInitialize, label, total: host.counts })
}

const names = [
  ...new Set(results.flatMap(result => [...result.total.keys()])),
].sort()
const width = Math.max(NAME_WIDTH_FLOOR, ...names.map(name => name.length))

console.log('wasi_snapshot_preview1 calls, as init/total\n')
console.log(
  [
    'import'.padEnd(width),
    ...results.map(result => result.label.padStart(CELL_WIDTH)),
  ].join(' | '),
)
for (const name of names) {
  console.log(
    [
      name.padEnd(width),
      ...results.map(result => {
        const init = result.afterInitialize.get(name) ?? 0
        const total = result.total.get(name) ?? 0
        return `${init}/${total}`.padStart(CELL_WIDTH)
      }),
    ].join(' | '),
  )
}

console.log(`\ncalled: ${names.length} of ${declared.size} declared`)
console.log(
  `never called: ${[...declared].filter(name => !names.includes(name)).join(', ')}`,
)
