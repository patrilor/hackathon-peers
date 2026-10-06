/**
 * Purga lo caducado de la caché y sale.
 *
 * No hace falta para que la web funcione: las filas caducadas se tratan como si
 * no existieran (`cache.get` devuelve `undefined`) y se sobrescriben solas.
 *
 * Existe para no dejar que la tabla crezca sin límite en un entorno de pruebas
 * donde se fuerzan TTL de 0:
 *
 *   npm run cache:purge
 */

import { closeDatabase, openDatabase } from '../src/db/database.js'
import { createCacheRepository } from '../src/db/repositories/cache.js'
import { loadEnv } from '../src/config/env.js'

const env = loadEnv()
const db = await openDatabase({
  url: env.DATABASE_URL,
  authToken: env.TURSO_AUTH_TOKEN,
})

try {
  const cache = createCacheRepository(db)
  const antes = await cache.count()
  const quitadas = await cache.purgeExpired()

  process.stdout.write(`Caché: ${antes} filas antes, ${quitadas} caducadas quitadas.\n`)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`No se pudo purgar la caché: ${message}\n`)
  process.exitCode = 1
} finally {
  closeDatabase(db)
}