import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { getVersion, lint } from '../src/browser.js'

/**
 * The browser entry loads its wasm over `fetch`, which Node implements for
 * http(s) only. Serving the file from disk lets the `browser_wasi_shim` path be
 * covered in CI without launching a browser.
 */
const realFetch = globalThis.fetch

/** The stub is handed a URL, a Request, or a plain string. */
const toPath = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') {
    return input
  }
  return input instanceof URL ? input.href : input.url
}

beforeAll(() => {
  globalThis.fetch = (input: RequestInfo | URL) =>
    readFile(fileURLToPath(toPath(input))).then(bytes => new Response(bytes))
})

afterAll(() => {
  globalThis.fetch = realFetch
})

test('reports the bundled hadolint version', async () => {
  await expect(getVersion()).resolves.toMatch(
    /^Haskell Dockerfile Linter \d+\.\d+\.\d+$/,
  )
})

test('finds nothing wrong with a pinned base image', async () => {
  await expect(lint('FROM alpine:3.20\n')).resolves.toEqual([])
})

test('reports violations with position and severity', async () => {
  const results = await lint('FROM ubuntu:latest\nRUN apt-get update\n')

  expect(results.map(({ code }) => code)).toEqual(['DL3007', 'DL3009'])
  expect(results[0]).toMatchObject({
    code: 'DL3007',
    line: 1,
    level: 'warning',
  })
})

test('reports an unparseable Dockerfile instead of throwing', async () => {
  const results = await lint('NOT A DOCKERFILE\n')

  expect(results[0]).toMatchObject({ code: 'DL1000', level: 'error' })
})

test('runs the same single-use module more than once', async () => {
  for (let index = 0; index < 3; index++) {
    await expect(lint('FROM alpine:3.20\n')).resolves.toEqual([])
  }
})
