export default {
  extends: ['@1stg/stylelint-config'],
  // A flat stylelint config is not paired with `.stylelintignore`; the paths it
  // listed, plus the sources the default CSS parser cannot read, live here.
  ignoreFiles: [
    '**/*.{cjs,cts,js,json,json5,jsonc,jsx,mjs,mts,ts,tsx}',
    '**/*.d.ts',
    '*.log',
    '*.patch',
    '*.yaml',
    '*.yml',
    'coverage/**',
    'dist/**',
    'LICENSE',
    'hadolint.wasm',
    'lib/**',
  ],
}
