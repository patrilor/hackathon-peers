/**
 * Repositorio de disponibilidad ("de guardia").
 *
 * Este es el único dato de Sanatorio que **no** viene de la API de 42: nadie
 * en 42 publica si está disponible para ayudarte. Se guarda solo en nuestra
 * base, y por eso el endpoint que lo escribe no llama a la API de 42 en absoluto.
 */

import type { Db } from '../database.js'
import { nowIso } from '../database.js'

type AvailabilityRow = { login: string; available: number; updated_at: string }

export function createAvailabilityRepository(db: Db) {
  return {
    /**
     * Marca la disponibilidad de una persona.
     *
     * Se guarda siempre una fila explícita, incluso para `false`: así el
     * endpoint puede devolver siempre un booleano en vez de `undefined`, y el
     * front no tiene que adivinar el valor por defecto.
     */
    set(login: string, available: boolean): boolean {
      db.prepare(
        `INSERT INTO availability (login, available, updated_at)
         VALUES (@login, @available, @updated_at)
         ON CONFLICT (login) DO UPDATE SET
           available  = excluded.available,
           updated_at = excluded.updated_at`,
      ).run({ login, available: available ? 1 : 0, updated_at: nowIso() })

      return available
    },

    /**
     * Disponibilidad de una persona. `false` si nunca la ha marcado.
     *
     * No devuelve `undefined` a propósito: el front trata `available` como
     * booleano y un `undefined` lo rompe.
     */
    get(login: string): boolean {
      const row = db
        .prepare<unknown[], AvailabilityRow>('SELECT available FROM availability WHERE login = ?')
        .get(login)
      return row?.available === 1
    },

    /** Última actualización, o `undefined` si nunca la ha marcado. */
    getUpdatedAt(login: string): string | undefined {
      return db
        .prepare<unknown[], AvailabilityRow>('SELECT updated_at FROM availability WHERE login = ?')
        .get(login)?.updated_at
    },

    /** Listado auxiliar para tests y diagnóstico. */
    listAll(): AvailabilityRow[] {
      return db
        .prepare<unknown[], AvailabilityRow>('SELECT * FROM availability ORDER BY login')
        .all()
    },
  }
}

export type AvailabilityRepository = ReturnType<typeof createAvailabilityRepository>
