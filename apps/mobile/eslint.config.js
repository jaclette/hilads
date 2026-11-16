// ESLint 9 flat config: Expo's recommended rules (eslint-config-expo, SDK 53 line).
// `npm run lint`. Generated and native folders are ignored.
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['ios/**', 'android/**', '.expo/**', 'dist/**', 'targets/**', 'node_modules/**', 'build-*', 'scripts/**'],
  },
]);
