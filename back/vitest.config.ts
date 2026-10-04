import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    /**
     * `unit`  → funciones puras, sin red ni disco.
     * `integration` → levanta la app con la API de 42 simulada y base temporal.
     *
     * Los tests de integración van aparte para poder lanzar solo los rápidos
     * mientras develops:  npm run test:unit
     */
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    // Los tests de integración abren el mismo fichero SQLite desde varios
    // ficheros; paralelismo por fichero, no por test.
    pool: 'forks',
    testTimeout: 20_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts', 'src/cli/**'],
    },
  },
})