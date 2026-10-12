import config from '@1stg/eslint-config'

export default [
  {
    ignores: [
      'auto-imports.d.ts',
      'CHANGELOG.md',
      'coverage',
      'dist',
      'hadolint.wasm',
      'lib',
      'pnpm-lock.yaml',
      'public/_redirects',
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
