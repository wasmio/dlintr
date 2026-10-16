import autoImport from 'unplugin-auto-import/vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    autoImport({
      imports: 'vitest',
    }),
  ],
  test: {
    // Vitest's default `forks` pool runs each test file in a child process, and
    // on Windows that worker intermittently dies while running
    // `test/reactor.spec.ts`:
    //
    //   Worker exited unexpectedly with exit code 3221225477 …
    //
    // `3221225477` is `0xC0000005`. Four observations so far, **every one on
    // Node 22** (Windows three times, macOS once), and the identical job passes
    // when re-run — so it is the runner's process model, not the module under
    // test. `threads` is a supported pool that does not use it.
    //
    // This avoids the crash rather than explaining it. It is deliberately not a
    // `retry`: the tests still run and still have to pass, and a real failure
    // still fails the job.
    pool: process.platform === 'win32' ? 'threads' : 'forks',
    coverage: {
      provider: 'istanbul',
      reporter: ['lcov', 'json', 'text'],
    },
  },
})
