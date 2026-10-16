import config from '@1stg/eslint-config'

export default [
  {
    ignores: [
      'auto-imports.d.ts',
      'CHANGELOG.md',
      'coverage',
      'dist',
      // cabal's build directory, wherever a local `wasm/build*.sh` leaves one.
      '**/dist-newstyle',
      // Patterns, not names: see the note in `stylelint.config.js`. The glue
      // stays by name because it *is* a `.js` file, and a glob could not tell
      // it apart from source that should be linted.
      '**/*.wasm',
      '**/*.sha256',
      'ghc_wasm_jsffi.js',
      'lib',
      'pnpm-lock.yaml',
      // The pinned hadolint checkout; its website assets are not ours to lint.
      'hadolint',
    ],
  },
  ...config,
  {
    settings: {
      // `node:wasi` is a builtin the resolver does not know about.
      'import-x/core-modules': ['node:wasi'],
    },
  },
]
