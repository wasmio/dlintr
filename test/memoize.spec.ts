import { expect, test } from 'vitest'

import { memoize } from '../src/memoize.js'

test('loads once and reuses the result', async () => {
  let calls = 0
  const cached = memoize(() => {
    calls += 1
    return Promise.resolve('value')
  })

  expect(await cached()).toBe('value')
  expect(await cached()).toBe('value')
  expect(calls).toBe(1)
})

test('does not cache a rejection, so a transient failure can be retried', async () => {
  let calls = 0
  const cached = memoize(() => {
    calls += 1
    return calls === 1
      ? Promise.reject(new Error('transient'))
      : Promise.resolve('recovered')
  })

  await expect(cached()).rejects.toThrow('transient')
  expect(await cached()).toBe('recovered')
  expect(calls).toBe(2)
})

test('a rejection is handled even when the caller never awaits it', async () => {
  // `memoize` attaches its own handler, so a caller that fires and forgets does
  // not leave an unhandled rejection behind — which vitest treats as a test-run
  // error, so this fails loudly rather than asserting nothing.
  const cached = memoize(() => Promise.reject(new Error('transient')))

  void cached()
  await new Promise(resolve => {
    setTimeout(resolve, 0)
  })

  expect(await cached().catch(String)).toBe('Error: transient')
})
