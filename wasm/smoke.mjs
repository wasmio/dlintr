/**
 * Smoke-tests a built `hadolint.wasm` before it is published.
 *
 * This exists because the interesting failure mode is silent: a wasm module can
 * link, shrink to a plausible size, and still die at startup on something like
 * `getHomeDirectory:getEffectiveUserID` — the wasip1 syscall GHC's
 * `getHomeDirectory` reaches for that does not exist. So we actually start it
 * and check what it says.
 *
 * Runs the module the same way `src/wasi-node.ts` does — a WASI preview1
 * command, `node:wasi`, `HOME` set. stdout/stderr go to temp files rather than
 * to the host's descriptors, because uvwasi closes the descriptors it is handed
 * when the instance is torn down.
 *
 * Usage: node wasm/smoke.mjs [path/to/hadolint.wasm]
 */
import {
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WASI } from 'node:wasi'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const wasm = path.resolve(process.argv[2] ?? path.join(root, 'hadolint.wasm'))

const bytes = readFileSync(wasm)
const module = await WebAssembly.compile(bytes)

/**
 * Run the module once and collect what it wrote.
 *
 * @param {string[]} args
 * @param {{ stdin?: string; workdir?: string }} [options]
 * @returns {{ exitCode: number; stdout: string; stderr: string }} The exit
 *   status, and whatever the module wrote to stdout and stderr.
 */
const run = (args, { stdin = '', workdir } = {}) => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'dlintr-smoke-'))
  try {
    const stdinPath = path.join(scratch, '.stdin')
    const stdoutPath = path.join(scratch, '.stdout')
    const stderrPath = path.join(scratch, '.stderr')
    writeFileSync(stdinPath, stdin)

    const wasi = new WASI({
      version: 'preview1',
      args: ['hadolint', ...args],
      // Without HOME the module dies before linting; see the note above.
      env: { HOME: workdir ?? scratch },
      ...(workdir ? { preopens: { [workdir]: workdir } } : {}),
      stdin: openSync(stdinPath, 'r'),
      stdout: openSync(stdoutPath, 'w'),
      stderr: openSync(stderrPath, 'w'),
      returnOnExit: true,
    })

    const instance = new WebAssembly.Instance(module, {
      wasi_snapshot_preview1: wasi.wasiImport,
    })
    const exitCode = wasi.start(instance) ?? 0

    return {
      exitCode,
      stdout: readFileSync(stdoutPath, 'utf8'),
      stderr: readFileSync(stderrPath, 'utf8'),
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

let failures = 0

/**
 * @param {string} what
 * @param {boolean} ok
 * @param {string} [detail]
 */
const check = (what, ok, detail) => {
  const suffix = detail && !ok ? `\n     ${detail}` : ''
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${suffix}`)
  if (!ok) {
    failures++
  }
}

// 1. It starts at all, and knows what it is.
const version = run(['--version'])
check(
  '--version reports a hadolint version',
  version.exitCode === 0 &&
    /Haskell Dockerfile Linter \d+\.\d+\.\d+/.test(version.stdout),
  `exit=${version.exitCode} stdout=${JSON.stringify(version.stdout)} stderr=${JSON.stringify(version.stderr)}`,
)

// 2. It can actually lint: a `latest` base must trip DL3007.
const workdir = mkdtempSync(path.join(tmpdir(), 'dlintr-smoke-work-'))
try {
  writeFileSync(path.join(workdir, 'Dockerfile'), 'FROM ubuntu:latest\n')
  const lint = run(['--no-color', path.join(workdir, 'Dockerfile')], {
    workdir,
  })
  check(
    'linting a Dockerfile reports DL3007',
    lint.stdout.includes('DL3007'),
    `exit=${lint.exitCode} stdout=${JSON.stringify(lint.stdout)} stderr=${JSON.stringify(lint.stderr)}`,
  )
  check(
    'a finding fails the run',
    lint.exitCode === 1,
    `expected exit 1, got ${lint.exitCode}`,
  )
} finally {
  rmSync(workdir, { recursive: true, force: true })
}

// 3. It is a WASI command, not a reactor — that is what `run`/`lint` rely on.
check(
  'exports _start and imports only wasi_snapshot_preview1',
  WebAssembly.Module.exports(module).some(({ name }) => name === '_start') &&
    WebAssembly.Module.imports(module).every(
      ({ module: m }) => m === 'wasi_snapshot_preview1',
    ),
  `imports=${[...new Set(WebAssembly.Module.imports(module).map(({ module: m }) => m))].join(', ')}`,
)

console.log(
  `\n${wasm}: ${(bytes.byteLength / 1024 / 1024).toFixed(2)} MiB, ${failures} failure(s)`,
)

if (failures > 0) {
  throw new Error(`${failures} smoke check(s) failed against ${wasm}`)
}
