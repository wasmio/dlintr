import { getVersion, lint } from 'dlintr'
import type { Severity } from 'dlintr'

/** A pinned base image, which hadolint has nothing to say about. */
const CLEAN = 'FROM alpine:3.20\n'
/** An unpinned base image, which trips DL3007. */
const UNPINNED = 'FROM ubuntu:latest\n'
/** A registry, which only DL3026 has an opinion about. */
const REGISTRY = 'FROM myregistry.example.com/team/image:1.0\n'

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
  // The rest of the shape a consumer reads. `message` and `file` come out of
  // `Main.hs`'s port of upstream's JSON encoder, and since the byte-equality
  // test went, this is what notices if that port stops emitting a field.
  expect(typeof results[0]?.message).toBe('string')
  expect(typeof results[0]?.file).toBe('string')
  expect(results[1]).toMatchObject({ code: 'DL3009', line: 2, level: 'info' })
})

test('reports an unparseable Dockerfile instead of throwing', async () => {
  const results = await lint('NOT A DOCKERFILE\n')

  expect(results).toHaveLength(1)
  expect(results[0]).toMatchObject({ code: 'DL1000', line: 1, level: 'error' })
  // A parse error goes through the *other* `ToJSON` instance in `Main.hs`, so
  // its shape is asserted rather than assumed to match the finding path.
  expect(typeof results[0]?.message).toBe('string')
  expect(typeof results[0]?.file).toBe('string')
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

test('reads configuration from the environment', async () => {
  await expect(
    lint(UNPINNED, { env: { HADOLINT_IGNORE: 'DL3007' } }),
  ).resolves.toEqual([])
})

// This is what proves the reactor can see the environment at all, and so that
// `env` was not lost along with the CLI's argument surface. The reactor imports
// `environ_get`, the host supplies it, and this turns that from a reading of the
// import table into a fact.
//
// DL3026 only fires when trusted registries are configured *and* do not match:
// with none configured, `Set.null allowed` short-circuits the check.
test('DL3026 follows HADOLINT_TRUSTED_REGISTRIES, and reverts without it', async () => {
  const withoutEnv = await lint(REGISTRY)
  expect(withoutEnv.map(({ code }) => code)).not.toContain('DL3026')

  const withEnv = await lint(REGISTRY, {
    env: { HADOLINT_TRUSTED_REGISTRIES: 'docker.io' },
  })
  expect(withEnv.map(({ code }) => code)).toContain('DL3026')

  // And back again, so the environment is per-instance rather than leaking from
  // whichever reactor the previous call happened to cache.
  const reverted = await lint(REGISTRY)
  expect(reverted.map(({ code }) => code)).not.toContain('DL3026')
})

test('the module is instantiated once and called repeatedly', async () => {
  for (let index = 0; index < 3; index++) {
    await expect(lint(CLEAN)).resolves.toEqual([])
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

test('an override for a rule that did not fire changes nothing', async () => {
  const results = await lint(CLEAN, {
    severityOverrides: { DL3007: 'error' as Severity },
  })

  expect(results).toEqual([])
})
