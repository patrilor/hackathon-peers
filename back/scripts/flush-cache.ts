/**
 * Borra la caché entera y sale.
 *
 * Es el "reinicio" del plan solo-Madrid. Cuando cambian las reglas con las que
 * se rellenó la caché (el caso por antonomasia: desplegar el filtro por campus
 * cuando las páginas guardadas traen gente de todo el mundo), las filas viejas
 * seguirían viviendo hasta caducar solas y se servirían tal cual. Borrarlas de
 * golpe hace que todo se reconstruya con la regla nueva.
 *
 * Conserva el resto de la base (`availability`): solo se toca la caché.
 *
 * Distinto de `npm run cache:purge`: ahí solo se borra lo caducado; aquí, todo.
 *
 *   npm run cache:flush   (o `make flush-cache`)
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
  const borradas = await cache.clearAll()

  process.stdout.write(
    `Caché: ${antes} filas antes, ${borradas} borradas. ` +
      `Se reconstruirá solo con el campus ${env.CAMPUS_ID} (siémbralo si hace falta con \`npm run madrid:seed\`).\n`,
  )
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`No se pudo vaciar la caché: ${message}\n`)
  process.exitCode = 1
} finally {
  closeDatabase(db)
}