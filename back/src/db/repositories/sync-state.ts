/**
 * Repositorio del estado de la sincronización.
 *
 * Guarda checkpoints y marcas de tiempo. Sin esto, cada reinicio del backend
 * volvería a pedir a la API de 42 lo mismo de cero, y con el límite de 1200
 * peticiones por hora eso agota la cuota del día entero en un solo arranque.
 *
 * Guardar el checkpoint en la misma base de datos que los datos es lo que
 * permite reanudar: si el proceso muere a mitad, se sabe por dónde iba.
 */

import type { Db } from '../database.js'
import { nowIso } from '../database.js'

/** Claves de checkpoint que el sincronizador usa. */
export const SYNC_KEYS = {
  /** Última vez que se sincronizaron los proyectos de un usuario. */
  USER_PROJECTS: 'user_projects_synced_at',
  /** Login por el que va la sincronización, para poder reanudar. */
  LAST_USER: 'last_user_login',
  /** Cursor de paginación en la sincronización del campus. */
  CAMPUS_PAGE: 'campus_page',
} as const

export function createSyncStateRepository(db: Db) {
  return {
    /** Lee un valor, o `undefined` si la clave no existe. */
    get(key: string): string | undefined {
      return db
        .prepare<unknown[], { value: string }>('SELECT value FROM sync_state WHERE key = ?')
        .get(key)?.value
    },

    /** Escribe un valor y actualiza su marca de tiempo. */
    set(key: string, value: string): void {
      db.prepare(
        `INSERT INTO sync_state (key, value, updated_at)
         VALUES (@key, @value, @updated_at)
         ON CONFLICT (key) DO UPDATE SET
           value      = excluded.value,
           updated_at = excluded.updated_at`,
      ).run({ key, value, updated_at: nowIso() })
    },

    /**
     * Lee un valor como fecha. `undefined` si no existe o si no se puede leer.
     *
     * Se envuelve en un try porque un checkpoint corrupto (un `NaN` escrito a
     * mano, por ejemplo) no debe tumbar la sincronización: se trata como
     * "nunca sincronizado" y se vuelve a empezar por el principio.
     */
    getDate(key: string): Date | undefined {
      const raw = this.get(key)
      if (raw === undefined) {
        return undefined
      }
      const parsed = new Date(raw)
      return Number.isNaN(parsed.getTime()) ? undefined : parsed
    },

    /** Escribe una fecha como checkpoint. */
    setDate(key: string, date: Date): void {
      this.set(key, date.toISOString())
    },

    /** Borra una clave. Se usa para forzar una resincronización completa. */
    delete(key: string): void {
      db.prepare('DELETE FROM sync_state WHERE key = ?').run(key)
    },

    /** Todas las claves con su valor. Para diagnóstico y logs de arranque. */
    listAll(): { key: string; value: string; updated_at: string }[] {
      return db
        .prepare<unknown[], { key: string; value: string; updated_at: string }>(
          'SELECT key, value, updated_at FROM sync_state ORDER BY key',
        )
        .all()
    },
  }
}

export type SyncStateRepository = ReturnType<typeof createSyncStateRepository>
