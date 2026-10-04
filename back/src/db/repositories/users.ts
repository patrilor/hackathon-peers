/**
 * Repositorio de personas.
 *
 * La API de 42 devuelve el mismo usuario en tres formatos distintos según el
 * endpoint (completo en `/users/:login`, resumido dentro de `projects_users`,
 * envuelto en `user` dentro de `locations`). Este repositorio es el único sitio
 * donde se normaliza eso, para que el resto del código vea siempre la misma fila.
 */

import type { Db } from '../database.js'
import { nowIso } from '../database.js'
import type { ApiUser } from '../../domain/types.js'

/** Fila de la tabla `users`. */
type UserRow = {
  login: string
  user_id: number
  kind: string
  usual_full_name: string | null
  image_url: string | null
}

/** Datos mínimos para insertar o actualizar una persona. */
export type UserInput = {
  login: string
  id: number
  kind?: string | null
  usualFullName?: string | null
  imageUrl?: string | null
}

/**
 * Normaliza un usuario de la API a la forma de la tabla.
 *
 * `image` en la API es un objeto `{ url }`, no una cadena. Guardar el objeto
 * entero fue el error que hizo que la primera versión de `/auth/me` devolviera
 * `[object Object]` en el campo `image`.
 */
export function toUserInput(user: ApiUser): UserInput {
  return {
    login: user.login,
    id: user.id,
    kind: user.kind ?? 'student',
    usualFullName: user.usual_full_name ?? null,
    imageUrl: user.image?.url ?? null,
  }
}

export function createUsersRepository(db: Db) {
  const upsertMany = db.transaction((users: readonly UserInput[]) => {
    const statement = db.prepare<unknown[], UserRow>(
      `INSERT INTO users (login, user_id, kind, usual_full_name, image_url, synced_at)
       VALUES (@login, @user_id, @kind, @usual_full_name, @image_url, @synced_at)
       ON CONFLICT (login) DO UPDATE SET
         user_id         = excluded.user_id,
         kind            = excluded.kind,
         usual_full_name = excluded.usual_full_name,
         image_url       = excluded.image_url,
         synced_at       = excluded.synced_at`,
    )

    const syncedAt = nowIso()
    for (const user of users) {
      statement.run({
        login: user.login,
        user_id: user.id,
        kind: user.kind ?? 'student',
        usual_full_name: user.usualFullName ?? null,
        image_url: user.imageUrl ?? null,
        synced_at: syncedAt,
      })
    }
  })

  return {
    /**
     * Inserta o actualiza un lote de personas en una sola transacción.
     *
     * Se agrupan a propósito: el sincronizador recibe cientos de usuarios por
     * página y una transacción por usuario sería un desperdicio.
     */
    upsertMany(users: readonly UserInput[]): void {
      if (users.length === 0) {
        return
      }
      upsertMany(users)
    },

    /** Devuelve una persona por su login, o `undefined` si no la conocemos. */
    findByLogin(login: string): UserRow | undefined {
      return db
        .prepare<unknown[], UserRow>('SELECT * FROM users WHERE login = ?')
        .get(login)
    },

    /** Devuelve una persona por su id numérico de la API. */
    findById(userId: number): UserRow | undefined {
      return db
        .prepare<unknown[], UserRow>('SELECT * FROM users WHERE user_id = ?')
        .get(userId)
    },

    /** Número de personas guardadas. Útil en tests y para logs de diagnóstico. */
    count(): number {
      return db.prepare<unknown[], { total: number }>('SELECT COUNT(*) AS total FROM users').get()
        ?.total ?? 0
    },
  }
}

export type UsersRepository = ReturnType<typeof createUsersRepository>
