export default {
  extends: ['@1stg/stylelint-config'],
  // A flat stylelint config is not paired with `.stylelintignore`; the paths it
  // listed, plus the sources the default CSS parser cannot read, live here.
  ignoreFiles: [
    '**/*.{cjs,cts,js,json,json5,jsonc,jsx,mjs,mts,ts,tsx}',
    '**/*.d.ts',
    // These suffixes are never CSS, and the patterns are anchored so that they
    // also cover nested files (`wasm/build-reactor.sh`); a bare `*.sh` would
    // only reach the repository root.
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
    // cabal's build directory: it holds checked-out dependency sources, so it
    // contains markdown and YAML the CSS parser would otherwise be handed.
    '**/dist-newstyle/**',
    'LICENSE',
    // Patterns, not names. Naming artifacts individually has already trailed
    // three renames on this branch — `hadolint.wasm`, its `.sha256`, and the
    // command build — and each new name was parsed as CSS before anyone
    // noticed. A glob closes the class.
    '**/*.wasm',
    '**/*.sha256',
    'lib/**',
    // The pinned hadolint checkout ships its own website CSS.
    'hadolint/**',
  ],
}
