// ESLint 9 flat config: Expo's recommended rules (eslint-config-expo, SDK 58 line).
// `npm run lint`. Generated and native folders are ignored.
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['ios/**', 'android/**', '.expo/**', 'dist/**', 'targets/**', 'node_modules/**', 'build-*', 'scripts/**'],
  },
  {
    rules: {
      // The React Compiler rules that arrived with the SDK 58 config flag patterns used across the app
      // (refs read in render, setState in effects...): warnings until the app moves to the compiler.
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/static-components': 'warn',
      // TypeScript already checks namespace members; this rule misreads re-exports (Notifications.AndroidImportance).
      'import/namespace': 'off',
    },
  },
]);
