import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'

/**
 * Deliberately small: this exists to catch the class of bug that reaches
 * production because `vite build` cannot see it.
 *
 * `vite build` bundles - it does not resolve free identifiers. A hook used
 * without being imported (`useCallback` in App.jsx, which white-screened the
 * whole app) is valid JavaScript until it executes, so the build stayed green
 * and only the browser found it. `no-undef` catches exactly that, instantly.
 *
 * NOT a style pass. Formatting, unused vars and exhaustive-deps stay off:
 * turning them on over a 7k-line App.jsx would produce hundreds of findings
 * nobody triages, and a lint step people ignore is worse than none. Add rules
 * when a real bug justifies one - that's how this file grew to what it is.
 */
export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'public/**', 'design-src/**', '**/*.ts'],
  },
  {
    files: ['**/*.js', '**/*.jsx', '**/*.mjs'],
    // 'latest': api/prerender.mjs uses import attributes (`with { type: 'json' }`).
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
        ...globals.es2021,
        // Vite injects these at build time.
        process: 'readonly',
        __DEV__: 'readonly',
      },
    },
    // Registered so the `// eslint-disable-line react-hooks/exhaustive-deps`
    // comments already in the codebase resolve to a known rule instead of
    // erroring with "Definition for rule not found".
    plugins: { 'react-hooks': reactHooks },
    // exhaustive-deps is off by choice, so its existing disable comments are
    // dormant, not stale - don't report them. They reactivate if the rule is
    // ever switched on.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      'no-undef': 'error',
      // Hooks called conditionally / in loops corrupt React's hook order and
      // fail at runtime in ways that look like unrelated state bugs.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'off',
    },
  },
  {
    // Vercel serverless functions + build scripts run in Node, not the browser.
    files: ['api/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
]
