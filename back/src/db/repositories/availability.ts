/**
 * Repositorio de disponibilidad ("de guardia").
 *
 * Este es el único dato de Sanatorio que **no** viene de la API de 42: nadie
 * en 42 publica si está disponible para ayudarte. Se guarda solo en nuestra
 * base, y por eso el endpoint que lo escribe no llama a la API de 42 en absoluto.
 *
 * No hay clave foránea a ninguna tabla de personas a propósito: no hay tabla de
 * personas. Quien entra puede marcarse disponible sin que nada más exista sobre
 * él en nuestra base.
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
    async set(login: string, available: boolean): Promise<boolean> {
      await db.execute({
        sql: `INSERT INTO availability (login, available, updated_at)
              VALUES (?, ?, ?)
              ON CONFLICT (login) DO UPDATE SET
                available  = excluded.available,
                updated_at = excluded.updated_at`,
        args: [login, available ? 1 : 0, nowIso()],
      })

      return available
    },

    /**
     * Disponibilidad de una persona. `false` si nunca la ha marcado.
     *
     * No devuelve `undefined` a propósito: el front trata `available` como
     * booleano y un `undefined` lo rompe.
     */
    async get(login: string): Promise<boolean> {
      const result = await db.execute({
        sql: 'SELECT available FROM availability WHERE login = ?',
        args: [login],
      })
      const row = result.rows[0] as { available?: number } | undefined

      return row !== undefined && Number(row.available) === 1
    },

    /** Última actualización, o `undefined` si nunca la ha marcado. */
    async getUpdatedAt(login: string): Promise<string | undefined> {
      const result = await db.execute({
        sql: 'SELECT updated_at FROM availability WHERE login = ?',
        args: [login],
      })
      const row = result.rows[0] as { updated_at?: string } | undefined

      return row?.updated_at ?? undefined
    },

    /**
     * Todas las filas de disponibilidad, indexadas por login.
     *
     * Se usa para juntar los peers con su guardia en una sola consulta en vez de
     * una por persona: con 2 000 participantes eso serían 2 000 llamadas a la
     * base, y la tabla es diminuta (una fila por quien ha tocado el toggle).
     */
    async mapOfAll(): Promise<Map<string, boolean>> {
      const result = await db.execute('SELECT login, available FROM availability')
      const map = new Map<string, boolean>()

      for (const row of result.rows as unknown as AvailabilityRow[]) {
        map.set(row.login, row.available === 1)
      }

      return map
    },

    /** Listado auxiliar para tests y diagnóstico. */
    async listAll(): Promise<AvailabilityRow[]> {
      const result = await db.execute('SELECT * FROM availability ORDER BY login')

      return result.rows as unknown as AvailabilityRow[]
    },
  }
}

export type AvailabilityRepository = ReturnType<typeof createAvailabilityRepository>