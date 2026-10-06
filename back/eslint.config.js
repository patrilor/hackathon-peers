import js from '@eslint/js'
import { defineConfig } from 'eslint/config'
import tseslint from 'typescript-eslint'

/**
 * Las reglas type-checked solo se aplican a TypeScript: necesitan tipos, y un
 * `.js` que no está en ningún tsconfig no los tiene. Sin este filtro, ESLint
 * aborta con "rule requires type information" en cuanto aparece un `.js`.
 */
const soloTs = (configs) => configs.map((config) => ({ ...config, files: ['**/*.ts'] }))

/**
 * ESLint plano: los 4 pasos que exigimos a todo el código del backend.
 *
 * 1. type-checked: los errores de tipos se ven en el lint, no al compilar.
 * 2. Sin `any` implícito: los tipos se declaran, no se adivinan.
 * 3. Sin promesas sin await: un `await` forgotten es un bug silencioso.
 * 4. Nombres de variables consistentes.
 */
export default defineConfig(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'data/**'],
  },
  js.configs.recommended,
  ...soloTs(tseslint.configs.strictTypeChecked),
  ...soloTs(tseslint.configs.stylisticTypeChecked),
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: {
          // `eslint.config.js` es JavaScript y no entra en ningún tsconfig, así
          // que el servicio de proyectos de TS no lo encuentra sin esto.
          allowDefaultProject: ['eslint.config.js'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      // Interpolar un número en un mensaje de error es normal; lo que no se
      // quiere es interpolar objetos o arrays por accidente.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    /**
     * Relajas solo para los tests, y por razones concretas:
     * - `require-await`: un doble de `sleep` tiene que devolver una promesa, pero
     *   no hay nada que esperar dentro.
     * - `no-floating-promises`: los tests disparan llamadas en paralelo a
     *   propósito, para probar la serialización del limitador.
     */
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      'no-console': 'off',
    },
  },
)