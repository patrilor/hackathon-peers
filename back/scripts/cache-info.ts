/**
 * `make cache`: qué hay en la base de datos ahora mismo.
 *
 * Para responder de un vistazo a "¿está la caché llena?" y "de qué proyectos
 * tengo lista?", que son las preguntas que sustituyen a "¿se ha sincronizado?",
 * ya que ya no hay réplica sino caché bajo demanda.
 *
 *   npm run cache:info
 */

import { loadEnv } from '../src/config/env.js'
import { closeDatabase, openDatabase } from '../src/db/database.js'
import type { Db } from '../src/db/database.js'
import { createAvailabilityRepository } from '../src/db/repositories/availability.js'
import { createCacheRepository } from '../src/db/repositories/cache.js'

// `make cache | head` cierra la tubería antes de que acabe el script. Sin esto
// es un `Error: write EPIPE` y un exit code 1.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code !== 'EPIPE') {
    throw error
  }
})

const env = loadEnv()
const db = await openDatabase({
  url: env.DATABASE_URL,
  authToken: env.TURSO_AUTH_TOKEN,
})

try {
  const cache = createCacheRepository(db)
  const availability = createAvailabilityRepository(db)
  const deGuardia = (await availability.listAll()).filter((row) => row.available === 1)

  const proyectos = await proyectosEnCache(db)

  process.stdout.write('\n')
  process.stdout.write(`  ${'en caché'.padEnd(16)}${String(await cache.count()).padStart(6)}\n`)
  process.stdout.write(`  ${'de guardia'.padEnd(16)}${String(deGuardia.length).padStart(6)}\n`)

  if (proyectos.size > 0) {
    process.stdout.write('\n  proyectos en caché:\n')

    for (const [id, paginas] of [...proyectos.entries()].sort(([a], [b]) => a - b)) {
      process.stdout.write(
        `    ${String(id).padEnd(10)}${String(paginas).padStart(4)} página(s)\n`,
      )
    }
  }

  process.stdout.write('\n')
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`No se pudo leer la base: ${message}\n`)
  process.exitCode = 1
} finally {
  closeDatabase(db)
}

/**
 * Qué proyectos tienen algo en caché, y cuántas páginas de cada uno.
 *
 * Sale de las propias claves (`peers:2689:p1`) sin tocar los valores: así el
 * script no tiene que parsear 400 KB de JSON por página solo para contar.
 */
async function proyectosEnCache(db: Db): Promise<Map<number, number>> {
  const result = await db.execute("SELECT key FROM cache WHERE key LIKE 'peers:%'")
  const porProyecto = new Map<number, number>()

  for (const row of result.rows) {
    const clave = row.key
    if (typeof clave !== 'string') {
      continue
    }

    const [, , id] = /^peers:(\d+):/.exec(clave) ?? []
    if (id !== undefined) {
      const proyectoId = Number(id)
      porProyecto.set(proyectoId, (porProyecto.get(proyectoId) ?? 0) + 1)
    }
  }

  return porProyecto
}