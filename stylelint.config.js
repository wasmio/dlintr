export default {
  extends: ['@1stg/stylelint-config'],
  // A flat stylelint config is not paired with `.stylelintignore`; the paths it
  // listed, plus the sources the default CSS parser cannot read, live here.
  ignoreFiles: [
    '**/*.{cjs,cts,js,json,json5,jsonc,jsx,mjs,mts,ts,tsx}',
    '**/*.d.ts',
    // These suffixes are never CSS, and the patterns are anchored so that they
    // also cover nested files (`wasm/hadolint-wasm32-cli.patch`,
    // `wasm/build.sh`); a bare `*.patch` only reached the repository root.
    '**/*.log',
    '**/*.patch',
    '**/*.sh',
    '**/*.yaml',
    '**/*.yml',
    // The wasm build recipe is Haskell and cabal, not CSS.
    '**/*.cabal',
    '**/*.hs',
    '**/cabal.project',
    'coverage/**',
    'dist/**',
    'LICENSE',
    'hadolint.wasm',
    // The `.sha256` beside it is fetched by CI along with the binary; it is a
    // hex digest, which the CSS parser reports as `Unknown word`.
    'hadolint.wasm.sha256',
    'lib/**',
    // The pinned hadolint checkout ships its own website CSS.
    'hadolint/**',
  ],
}
