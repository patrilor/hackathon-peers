/**
 * Aplica las migraciones pendientes y sale.
 *
 * Existe para que `make up` no necesite arrancar el servidor. En producción no
 * hace falta: `app.ts` aplica las migraciones al montarse, así que la función de
 * Vercel migra sola en el arranque.
 *
 *   npm run db:migrate
 */

import { closeDatabase, migrate, openDatabase, schemaVersion } from '../src/db/database.js'
import { LATEST_VERSION, MIGRATIONS } from '../src/db/migrations.js'
import { loadEnv } from '../src/config/env.js'

const env = loadEnv()
const db = await openDatabase({
  url: env.DATABASE_URL,
  authToken: env.TURSO_AUTH_TOKEN,
})

try {
  const before = await schemaVersion(db)
  const applied = await migrate(db)

  if (applied.length === 0) {
    process.stdout.write(`Base de datos al día (versión ${before}).\n`)
  } else {
    const names = MIGRATIONS.filter((m) => applied.includes(m.version))
      .map((m) => `${m.version} (${m.name})`)
      .join(', ')

    process.stdout.write(`Migraciones aplicadas: ${names}\n`)
    process.stdout.write(`De la versión ${before} a la ${LATEST_VERSION}.\n`)
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`No se pudo migrar: ${message}\n`)
  process.exitCode = 1
} finally {
  closeDatabase(db)
}