import { fstatSync } from 'node:fs'

import { getVersion, lint, run } from 'dlintr'
import type { Severity } from 'dlintr'

/** A pinned base image, which hadolint has nothing to say about. */
const CLEAN = 'FROM alpine:3.20\n'
/** An unpinned base image, which trips DL3007. */
const UNPINNED = 'FROM ubuntu:latest\n'

test('reports the bundled hadolint version', async () => {
  await expect(getVersion()).resolves.toMatch(
    /^Haskell Dockerfile Linter \d+\.\d+\.\d+$/,
  )
})

test('finds nothing wrong with a pinned base image', async () => {
  await expect(lint(CLEAN)).resolves.toEqual([])
})

test('reports violations with position and severity', async () => {
  const results = await lint(`${UNPINNED}RUN apt-get update\n`)

  expect(results.map(({ code }) => code)).toEqual(['DL3007', 'DL3009'])
  expect(results[0]).toMatchObject({
    code: 'DL3007',
    line: 1,
    column: 1,
    level: 'warning',
  })
  expect(results[1]).toMatchObject({ code: 'DL3009', line: 2, level: 'info' })
})

test('reports an unparseable Dockerfile instead of throwing', async () => {
  const results = await lint('NOT A DOCKERFILE\n')

  expect(results).toHaveLength(1)
  expect(results[0]).toMatchObject({ code: 'DL1000', line: 1, level: 'error' })
})

test('suppresses rules passed to `ignore`', async () => {
  await expect(lint(UNPINNED, { ignore: ['DL3007'] })).resolves.toEqual([])
})

test('re-levels an individual rule with `severityOverrides`', async () => {
  const results = await lint(UNPINNED, {
    severityOverrides: { DL3007: 'error' },
  })

  expect(results[0]).toMatchObject({ code: 'DL3007', level: 'error' })
})

// hadolint answers a rejected option with exit 1 and an empty stdout, which must
// not be mistaken for "no findings".
test('surfaces a rejected option instead of reporting no findings', async () => {
  await expect(
    lint(UNPINNED, { severityOverrides: { DL3007: 'bogus' as Severity } }),
  ).rejects.toThrow(/Invalid option/)
})

// `lint` returns findings and drops the exit code, so a CI gate is either
// derived from `level`, or taken from `run` together with `--failure-threshold`.
test('exposes the exit code for gating', async () => {
  const { exitCode } = await run(
    ['--format', 'json', '--failure-threshold', 'error', '-'],
    { stdin: UNPINNED },
  )

  expect(exitCode).toBe(0)
})

test('reads configuration from the environment', async () => {
  await expect(
    lint(UNPINNED, { env: { HADOLINT_IGNORE: 'DL3007' } }),
  ).resolves.toEqual([])
})

test('exposes the raw CLI through `run`', async () => {
  const { exitCode, stdout, stderr } = await run(['--no-color', '-'], {
    stdin: UNPINNED,
  })

  expect(exitCode).toBe(1)
  expect(stdout).toContain('DL3007')
  expect(stderr).toBe('')
})

test('runs the same single-use module more than once', async () => {
  for (let index = 0; index < 3; index++) {
    await expect(lint(CLEAN)).resolves.toEqual([])
  }
})

// uvwasi closes the descriptors handed to it, so `node:wasi` must never be given
// one of the host's own — that works exactly once and then fails with EBADF.
test('leaves the host stdio descriptors open', async () => {
  await lint(CLEAN)

  for (const fd of [0, 1, 2]) {
    expect(() => fstatSync(fd)).not.toThrow()
  }
})

test('can lint several Dockerfiles concurrently', async () => {
  const results = await Promise.all([
    lint(UNPINNED),
    lint(CLEAN),
    lint('FROM debian:latest\n'),
  ])

  expect(results.map(({ length }) => length)).toEqual([1, 0, 1])
})
