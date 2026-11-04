import { getVersion, lint } from 'dlintr'
import type { LabelType, Severity } from 'dlintr'

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

test('an explicit option clears the variable it overrides', async () => {
  process.env.HADOLINT_IGNORE = 'DL3007'
  try {
    // The inherited value suppresses DL3007; an empty list has to undo that
    // rather than merely add nothing to it.
    await expect(lint(UNPINNED)).resolves.toEqual([])
    await expect(lint(UNPINNED, { ignore: [] })).resolves.toEqual([
      expect.objectContaining({ code: 'DL3007' }),
    ])
  } finally {
    delete process.env.HADOLINT_IGNORE
  }
})

test('reads HADOLINT_* from process.env when the option is absent', async () => {
  process.env.HADOLINT_IGNORE = 'DL3007'
  try {
    await expect(lint(UNPINNED)).resolves.toEqual([])
  } finally {
    delete process.env.HADOLINT_IGNORE
  }
})

// This is what proves the reactor can see the environment at all, and so that
// the `HADOLINT_*` variables reach it rather than being lost along with the
// CLI's argument surface. The reactor imports `environ_get`, the host supplies
// it, and this turns that from a reading of the import table into a fact.
//
// DL3026 only fires when trusted registries are configured *and* do not match:
// with none configured, `Set.null allowed` short-circuits the check.
test('DL3026 follows trustedRegistries, and reverts without it', async () => {
  const without = await lint(REGISTRY)
  expect(without.map(({ code }) => code)).not.toContain('DL3026')

  const trusted = await lint(REGISTRY, { trustedRegistries: ['docker.io'] })
  expect(trusted.map(({ code }) => code)).toContain('DL3026')

  // And back again, so the environment is per-instance rather than leaking from
  // whichever reactor the previous call happened to cache.
  const reverted = await lint(REGISTRY)
  expect(reverted.map(({ code }) => code)).not.toContain('DL3026')
})

test('disableIgnorePragma overrides the inline pragma', async () => {
  const source = '# hadolint ignore=DL3007\nFROM ubuntu:latest\n'

  const respected = await lint(source)
  expect(respected.map(({ code }) => code)).not.toContain('DL3007')

  const disabled = await lint(source, { disableIgnorePragma: true })
  expect(disabled.map(({ code }) => code)).toContain('DL3007')
})

test('requireLabels and strictLabels reach the label rules', async () => {
  const source = 'FROM alpine:3.20\nLABEL maintainer="someone"\n'

  const satisfied = await lint(source, {
    requireLabels: { maintainer: 'text' },
  })
  expect(satisfied.map(({ code }) => code)).not.toContain('DL3049')

  const missing = await lint(source, {
    requireLabels: { maintainer: 'text', version: 'semver' },
  })
  expect(missing.map(({ code }) => code)).toContain('DL3049')

  const superfluous = await lint(source, { strictLabels: true })
  expect(superfluous.map(({ code }) => code)).toContain('DL3050')
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

test('rejects label names the schema encoding cannot carry', async () => {
  // `HADOLINT_REQUIRE_LABELS` is `name:type,name:type`, so either character in a
  // name would silently split it into two requirements.
  await expect(
    lint(CLEAN, { requireLabels: { 'a,b': 'text' } }),
  ).rejects.toThrow(TypeError)
  await expect(
    lint(CLEAN, { requireLabels: { 'a:b': 'text' } }),
  ).rejects.toThrow(TypeError)
})

test('rejects a registry containing a comma', async () => {
  await expect(
    lint(REGISTRY, { trustedRegistries: ['docker.io,evil.example'] }),
  ).rejects.toThrow(TypeError)
})

test('rejects a label type hadolint cannot read', async () => {
  // hadolint drops a requirement whose type it does not recognise, which would
  // silently stop the label being required rather than failing.
  await expect(
    lint(CLEAN, { requireLabels: { maintainer: 'string' as LabelType } }),
  ).rejects.toThrow(TypeError)
})

test('an empty trustedRegistries list does not mean "trust nothing"', async () => {
  // hadolint reads `HADOLINT_TRUSTED_REGISTRIES=` as the single registry "",
  // so writing that value would make DL3026 fire on every image.
  const empty = await lint(REGISTRY, { trustedRegistries: [] })
  expect(empty.map(({ code }) => code)).not.toContain('DL3026')

  process.env.HADOLINT_TRUSTED_REGISTRIES = 'docker.io'
  try {
    // And it clears an inherited value rather than writing an empty one.
    const cleared = await lint(REGISTRY, { trustedRegistries: [] })
    expect(cleared.map(({ code }) => code)).not.toContain('DL3026')
  } finally {
    delete process.env.HADOLINT_TRUSTED_REGISTRIES
  }
})

test('ignore and severityOverrides reach a parse error', async () => {
  // DL1000 is reported outside hadolint's check list, so it cannot be filtered
  // or re-levelled through the reactor's environment: the findings are the only
  // place it exists.
  const BROKEN = 'FROM\n'

  const ignored = await lint(BROKEN, { ignore: ['DL1000'] })
  expect(ignored.map(({ code }) => code)).not.toContain('DL1000')

  const reified = await lint(BROKEN, { severityOverrides: { DL1000: 'style' } })
  expect(reified[0]).toMatchObject({ code: 'DL1000', level: 'style' })
})
