import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    'dist/**',
    'analysis_dist/**',
    'obfuscated_dist/**',
    'node_modules/**',
    'public/lib/**',
    'public/ocr/**',
    'compress_pdf/dist/**',
    'compress_pdf/node_modules/**',
    'pdf_to_word/**',
  ]),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-unused-vars': 'warn',
      'preserve-caught-error': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    files: ['*.config.js', 'generate_manifest.js', 'scripts/**/*.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
])
