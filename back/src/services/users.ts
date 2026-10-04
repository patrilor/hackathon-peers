/**
 * Servicio de las personas logueadas.
 *
 * Traduce la fila de SQLite a la forma que espera el front, que llama `image`
 * donde la base de datos llama `image_url`.
 */

import type { UsersRepository } from '../db/repositories/users.js'
import { domainError } from '../domain/errors.js'
import type { CurrentUser } from '../domain/types.js'

export function createUsersService(users: UsersRepository) {
  return {
    /** Persona de la sesión actual. Lanza 404 si aún no está replicada. */
    getByLogin(login: string): CurrentUser {
      const row = users.findByLogin(login)

      if (row === undefined) {
        // Puede pasar si alguien entra antes de que el sincronizador haya
        // pasado por él. Es un 404 honesto, no un fallo de infrastructure.
        throw domainError('not_found', `No hay datos replicados de ${login}`)
      }

      return { login: row.login, image: row.image_url }
    },

    /** ¿La persona existe ya en la réplica local? */
    exists(login: string): boolean {
      return users.findByLogin(login) !== undefined
    },
  }
}

export type UsersService = ReturnType<typeof createUsersService>
