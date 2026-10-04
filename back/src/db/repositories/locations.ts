/**
 * Repositorio de ubicaciones en el campus.
 *
 * `/campus/:id/locations` devuelve la lista completa de quien está ahora mismo
 * en el campus, así que la sincronización es de tipo "snapshot": se reemplaza
 * todo lo que había por lo que hay ahora. Así, quien se va del campus
 * desaparece de la tabla sin tener que detectarlo persona a persona.
 */

import type { Db } from '../database.js'
import { nowIso } from '../database.js'
import type { ApiCampusLocation } from '../../domain/types.js'

/** Fila de la tabla `user_locations`. */
type LocationRow = {
  login: string
  campus_id: number
  host: string
  is_primary: number
  updated_at: string
}

export function createLocationsRepository(db: Db) {
  /**
   * Aplica el snapshot de un campus: borra lo anterior y mete lo actual.
   *
   * Va en transacción para que nadie lea un estado intermedio del tipo
   * "ya se ha borrado el viejo pero todavía no se ha insertado el nuevo",
   * que mostraría el campus vacío durante un instante.
   */
  const replaceSnapshot = db.transaction(
    (campusId: number, entries: readonly ApiCampusLocation[]) => {
      db.prepare('DELETE FROM user_locations WHERE campus_id = ?').run(campusId)

      const statement = db.prepare(
        `INSERT INTO user_locations (login, campus_id, host, is_primary, updated_at)
         VALUES (@login, @campus_id, @host, @is_primary, @updated_at)
         ON CONFLICT (login) DO UPDATE SET
           campus_id  = excluded.campus_id,
           host       = excluded.host,
           is_primary = excluded.is_primary,
           updated_at = excluded.updated_at`,
      )

      const updatedAt = nowIso()
      for (const entry of entries) {
        // `host` es el puesto en el cluster. Viene a null si la API no lo
        // garantiza, y sin puesto la ubicación no sirve de nada.
        if (entry.host === null) {
          continue
        }
        statement.run({
          login: entry.user.login,
          campus_id: entry.campus_id,
          host: entry.host,
          is_primary: entry.primary === true ? 1 : 0,
          updated_at: updatedAt,
        })
      }
    },
  )

  return {
    /** Reemplaza por completo las ubicaciones conocidas de un campus. */
    replaceSnapshot(campusId: number, entries: readonly ApiCampusLocation[]): void {
      replaceSnapshot(campusId, entries)
    },

    /** Ubicación de una persona en un campus concreto, o `undefined`. */
    findByLogin(login: string, campusId?: number): LocationRow | undefined {
      if (campusId === undefined) {
        return db
          .prepare<unknown[], LocationRow>('SELECT * FROM user_locations WHERE login = ?')
          .get(login)
      }
      return db
        .prepare<unknown[], LocationRow>(
          'SELECT * FROM user_locations WHERE login = ? AND campus_id = ?',
        )
        .get(login, campusId)
    },

    /** Todos los del campus, ordenados por login para que sea determinista. */
    listByCampus(campusId: number): LocationRow[] {
      return db
        .prepare<unknown[], LocationRow>(
          'SELECT * FROM user_locations WHERE campus_id = ? ORDER BY login',
        )
        .all(campusId)
    },

    /** Cuántas personas hay ahora mismo en el campus. */
    countByCampus(campusId: number): number {
      return (
        db
          .prepare<unknown[], { total: number }>(
            'SELECT COUNT(*) AS total FROM user_locations WHERE campus_id = ?',
          )
          .get(campusId)?.total ?? 0
      )
    },
  }
}

export type LocationsRepository = ReturnType<typeof createLocationsRepository>
