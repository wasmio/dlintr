/**
 * `pnpm build:wasm` — produces `hadolint.wasm` and `ghc_wasm_jsffi.js` in the
 * package root: the two files the tarball ships and the tests load.
 *
 * On Linux and macOS this delegates to `wasm/build-reactor.sh`, which is the
 * recipe. On Windows it hands the same recipe to WSL2 through
 * `wasm/wsl-build.sh`.
 *
 * Windows is not a special case for its own sake. GHC's wasm backend ships
 * bindists for Linux and macOS hosts only — ghc-wasm-meta's `setup.sh` branches
 * on Linux and Darwin and has no Windows path at all — so there is no native
 * toolchain to run the recipe with. The *tests* do run natively on Windows, so
 * the two outputs are copied back out of the Linux filesystem into the Windows
 * workspace, which is where everything downstream expects them.
 *
 * This is why the script exists rather than `build:wasm` being a bare
 * `bash wasm/build-reactor.sh`: that works on two of the three platforms CI
 * runs on, and the third is the one that would otherwise silently skip.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const distro = process.env.DLINTR_WSL_DISTRO ?? 'Ubuntu'

/**
 * Runs a command with stdio inherited, and fails this script with its status.
 *
 * @param {string} command
 * @param {string[]} args
 */
const run = (command, args) => {
  // Both callers pass a literal from this file — `bash` or `wsl` — never
  // anything from the environment, which is what the rule guards against.

  const { error, status } = spawnSync(command, args, { stdio: 'inherit' })
  if (error) {
    throw new Error(`${command} could not be run: ${error.message}`)
  }
  if (status !== 0) {
    throw new Error(`${command} exited with status ${status}`)
  }
}

/**
 * `D:\a\dlintr\dlintr` becomes `/mnt/d/a/dlintr/dlintr`.
 *
 * Done here rather than with `wslpath`, which would mean pushing a Windows path
 * through `wsl.exe`'s argument handling to ask a question this file already has
 * the answer to.
 *
 * @param {string} windowsPath
 * @returns {string} The same location, spelled the way WSL sees it.
 */
const toWslPath = windowsPath =>
  windowsPath
    .replaceAll('\\', '/')
    .replace(/^([a-z]):/i, (_, drive) => `/mnt/${drive.toLowerCase()}`)

const main = () => {
  if (process.platform !== 'win32') {
    run('bash', [path.join(root, 'wasm', 'build-reactor.sh')])
    return
  }

  const workspace = toWslPath(root)
  run('wsl', [
    '-d',
    distro,
    '-e',
    'bash',
    `${workspace}/wasm/wsl-build.sh`,
    workspace,
  ])
}

try {
  main()
} catch (error) {
  process.stderr.write(
    `wasm: ${error instanceof Error ? error.message : String(error)}\n`,
  )
  process.exitCode = 1
}
