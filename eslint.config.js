import config from '@1stg/eslint-config'

export default [
  {
    ignores: [
      'auto-imports.d.ts',
      'CHANGELOG.md',
      'coverage',
      'dist',
      'hadolint.wasm',
      // Both are build outputs the WASM workflow drops in the package root, and
      // the artifact download lands them there again in CI.
      'hadolint.wasm.sha256',
      'lib',
      'pnpm-lock.yaml',
      // The pinned hadolint checkout; its website assets are not ours to lint.
      'vendor',
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
