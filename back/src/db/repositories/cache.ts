/**
 * Repositorio de la caché genérica.
 *
 * Una sola tabla guarda todo lo que viene de la API de 42. Cada fila es un JSON
 * con su caducidad, y la clave dice qué es. Tres recursos, tres prefijos:
 *
 * | Clave                    | Contenido                                     | Caduca a los |
 * |--------------------------|-----------------------------------------------|--------------|
 * | `user_projects:<login>`  | `[{ id, name }]` de lo que tiene en curso      | 30 min       |
 * | `peers:<id>:meta`        | `{ total, per_page, pages }`                  | 15 min       |
 * | `peers:<id>:p<n>`        | una página de participantes                   | 15 min       |
 *
 * Que los participantes vayan partido por páginas es lo que permite
 * racionar la descarga: la API va a 2 peticiones por segundo, así que bajarse
 * enteras las 21 páginas del proyecto `2689` serían ~11 s, y eso ya no cabe en
 * una función de Vercel. Guardando página a página, cada petición solo gasta un
 * presupuesto pequeño y devuelve lo que haya, esté completo o no.
 *
 * El JSON se guarda ya recortado: solo lo que el front necesita. La API manda
 * 25 campos por persona (`email`, `phone`, `wallet`, `correction_point`,
 * `data_erasure_date`…) y no hay ningún motivo para escribir en nuestra base lo
 * que la web no usa.
 */

import type { Db } from '../database.js'
import { isExpired, isoIn, nowIso } from '../database.js'

type CacheRow = { value: string; expires_at: string }

export function createCacheRepository(db: Db) {
  return {
    /**
     * Lee un valor de la caché.
     *
     * Devuelve `undefined` si no está **o si ha caducado**. Una fila caducada
     * se devuelve como si no existiera, y quien la escriba de nuevo la
     * sobrescribe; no hace falta borrar al leer.
     */
    async get<T>(key: string): Promise<T | undefined> {
      const result = await db.execute({
        sql: 'SELECT value, expires_at FROM cache WHERE key = ?',
        args: [key],
      })
      const row = result.rows[0] as unknown as CacheRow | undefined

      if (row === undefined || isExpired(row.expires_at)) {
        return undefined
      }

      try {
        return JSON.parse(row.value) as T
      } catch {
        // Un JSON corrupto es un bug, pero no motivo para tumbar la petición:
        // se trata como si no hubiera nada cacheado y se vuelve a pedir a la 42.
        return undefined
      }
    },

    /**
     * Lee un valor aunque esté caducado.
     *
     * Esto es lo que permite servir la última lista conocida cuando la API de 42
     * está caída. Un poco viejo se ve mejor que una pantalla de error: alguien
     * con un puesto `c2r17s2` hace media hora sigue siendo una pista útil, y la
     * respuesta lleva `X-Partial` para que el front lo diga.
     */
    async getStale<T>(key: string): Promise<T | undefined> {
      const result = await db.execute({
        sql: 'SELECT value FROM cache WHERE key = ?',
        args: [key],
      })
      const row = result.rows[0] as { value?: string } | undefined

      if (row === undefined || typeof row.value !== 'string') {
        return undefined
      }

      try {
        return JSON.parse(row.value) as T
      } catch {
        return undefined
      }
    },

    /** Escribe un valor con su caducidad. */
    async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
      const now = nowIso()

      await db.execute({
        sql: `INSERT INTO cache (key, value, expires_at, updated_at)
              VALUES (?, ?, ?, ?)
              ON CONFLICT (key) DO UPDATE SET
                value       = excluded.value,
                expires_at  = excluded.expires_at,
                updated_at  = excluded.updated_at`,
        args: [key, JSON.stringify(value), isoIn(ttlSeconds), now],
      })
    },

    /** Borra una clave. Se usa para invalidar al cambiar un proyecto a medias. */
    async drop(key: string): Promise<void> {
      await db.execute({ sql: 'DELETE FROM cache WHERE key = ?', args: [key] })
    },

    /** Borra todas las claves que empiezan por un prefijo. */
    async dropPrefix(prefix: string): Promise<void> {
      await db.execute({ sql: 'DELETE FROM cache WHERE key LIKE ?', args: [`${prefix}%`] })
    },

        /** Cuántas claves de un prefijo existen, estén caducadas o no. */
    async countWithPrefix(prefix: string): Promise<number> {
      const result = await db.execute({
        sql: 'SELECT COUNT(*) AS total FROM cache WHERE key LIKE ?',
        args: [`${prefix}%`],
      })
      return toCount(result.rows[0])
    },

    /** Número de filas en total. Caducadas incluidas. */
    count,

    /** Elimina lo caducado. Devuelve cuántas filas quitó. */
    async purgeExpired(): Promise<number> {
      // Se cuenta antes y después en vez de fiarse de `changes`, que
      // `@libsql/client` no expone igual para fichero local que para Turso.
      const before = await count()
      await db.execute({ sql: 'DELETE FROM cache WHERE expires_at <= ?', args: [nowIso()] })

      return before - (await count())
    },
  }

  /**
   * Cuenta las filas de la caché.
   *
   * Va fuera del objeto devuelto, a propósito: `purgeExpired` la necesita y
   * dentro del objeto habría que llamar a `this.count()`, que se rompe en
   * cuanto alguien destructura el repositorio (`const { purgeExpired } = cache`).
   */
  async function count(): Promise<number> {
    const result = await db.execute('SELECT COUNT(*) AS total FROM cache')

    return toCount(result.rows[0])
  }
}

/**
 * Lee el `COUNT(*)` de una consulta.
 *
 * Se acepta `number`, `bigint` y `string` a propósito: `@libsql/client` devuelve
 * enteros como número en SQLite local y puede devolverlos como `bigint` o como
 * texto hablando con Turso, según el tamaño y el protocolo.
 */
function toCount(row: unknown): number {
  const total = (row as { total?: number | bigint | string | null } | undefined)?.total

  return typeof total === 'number' ? total : Number(total ?? 0)
}

export type CacheRepository = ReturnType<typeof createCacheRepository>

// --- Claves ---------------------------------------------------------------

/** Clave de la lista de proyectos en curso de una persona. */
export function userProjectsKey(login: string): string {
  return `user_projects:${login}`
}

/** Clave de los metadatos de paginación de un proyecto. */
export function peersMetaKey(projectId: number): string {
  return `peers:${projectId}:meta`
}

/** Clave de una página concreta de participantes. */
export function peersPageKey(projectId: number, page: number): string {
  return `peers:${projectId}:p${page}`
}

/** Prefijo de todo lo que pertenece a un proyecto. */
export function peersPrefix(projectId: number): string {
  return `peers:${projectId}:`
}