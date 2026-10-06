/**
 * Siembra el directorio del campus: los logins de sus miembros.
 *
 * Es el listado con el que se filtra la lista de compañeros a "solo los de
 * nuestro campus" (por defecto Madrid, ver `CAMPUS_ID`). La API manda a todo
 * el mundo y la persona embebida en `projects_users` no trae campus, así que
 * sin este directorio no se puede saber quién es de aquí.
 *
 * Son decenas de páginas a 2 peticiones por segundo (unos 10-20 segundos en
 * Madrid), por eso se ejecuta una sola vez y el resultado se cachea `12` horas
 * (`CAMPUS_DIRECTORY_TTL_SECONDS`). Mientras no caduque, aunque expire, el
 * directorio sigue filtrando: mejor uno de hace unas horas que ninguno.
 *
 * Sin directorio, la lista de compañeros responde 500 con aviso a propósito:
 * no filtrar colaría gente de otros campus.
 *
 *   npm run madrid:seed   (o `make madrid`)
 */

import { createApiClient } from '../src/api/create-client.js'
import { loadEnv } from '../src/config/env.js'
import { closeDatabase, openDatabase } from '../src/db/database.js'
import { campusDirectoryKey, createCacheRepository } from '../src/db/repositories/cache.js'

const env = loadEnv()
const db = await openDatabase({
  url: env.DATABASE_URL,
  authToken: env.TURSO_AUTH_TOKEN,
})

try {
  const client = createApiClient(env)
  const logins = await client.fetchCampusLogins(env.CAMPUS_ID)

  if (logins.length === 0) {
    throw new Error(
      `El campus ${env.CAMPUS_ID} no devolvió ningún miembro. ` +
        `Revisa CAMPUS_ID (${env.CAMPUS_ID} = Madrid) o el scope de la app: ` +
        'un directorio vacío filtraría a todo el mundo y la web se quedaría sin gente.',
    )
  }

  await createCacheRepository(db).set(
    campusDirectoryKey(env.CAMPUS_ID),
    logins,
    env.CAMPUS_DIRECTORY_TTL_SECONDS,
  )

  process.stdout.write(
    `Directorio del campus ${env.CAMPUS_ID}: ${logins.length} miembros sembrados en la caché ` +
      `(caduca en ${Math.round(env.CAMPUS_DIRECTORY_TTL_SECONDS / 3600)} h).\n`,
  )
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`No se pudo sembrar el directorio del campus: ${message}\n`)
  process.exitCode = 1
} finally {
  closeDatabase(db)
}