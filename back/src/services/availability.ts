/**
 * Servicio de disponibilidad.
 *
 * El estado disponible/no disponible es nuestro, no de la 42: se guarda solo en
 * local y decide si alguien cuenta como compañero activo.
 */

import type { AvailabilityRepository } from '../db/repositories/availability.js'
import type { UsersRepository } from '../db/repositories/users.js'
import { domainError } from '../domain/errors.js'
import type { AvailabilityResponse } from '../domain/types.js'

/**
 * `available === true && location !== null` es la regla de guardia: estar
 * disponible sin puesto en el cluster no cuenta, porque no se puede emparejar.
 * No hace falta comprobarla aquí; vive en la consulta de `findPeers`.
 */

export function createAvailabilityService(
  availability: AvailabilityRepository,
  users: UsersRepository,
) {
  /** La tabla tiene FK a `users`, así que hay que comprobar antes de escribir. */
  function assertKnownUser(login: string): void {
    if (users.findByLogin(login) === undefined) {
      throw domainError('not_found', `No hay datos replicados de ${login}`)
    }
  }

  return {
    /**
     * Marca o desmarca la disponibilidad de una persona.
     *
     * @throws {DomainError} 400 si no llega un booleano, 404 si no está
     * replicada.
     */
    set(login: string, available: unknown): AvailabilityResponse {
      if (typeof available !== 'boolean') {
        throw domainError('invalid_input', 'El campo `available` tiene que ser un booleano')
      }

      assertKnownUser(login)
      availability.set(login, available)

      return { available }
    },

    /**
     * Disponibilidad guardada de una persona.
     *
     * Si nunca se ha marcado, se devuelve `false` en vez de un 404: acaba de
     * entrar y no ha tocado el toggle, y un error en pantalla para eso sería
     * peores que un "no disponible" honesto. El repositorio ya devuelve
     * `false` para quien no tiene fila.
     */
    get(login: string): AvailabilityResponse {
      return { available: availability.get(login) }
    },

    /** Cuándo se marcó por última vez, o `undefined` si nunca se ha hecho. */
    updatedAt(login: string): string | undefined {
      return availability.getUpdatedAt(login)
    },
  }
}

export type AvailabilityService = ReturnType<typeof createAvailabilityService>