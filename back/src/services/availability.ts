/**
 * Servicio de disponibilidad.
 *
 * El estado disponible/no disponible es nuestro, no de la 42: se guarda solo en
 * nuestra base y decide si alguien cuenta como compañero activo.
 *
 * Antes este servicio exigía que la persona estuviera replicada en la tabla
 * `users`, porque `availability` tenía clave foránea contra ella. Ya no hay
 * tabla de personas, así que no hay nada que comprobar: quien tiene sesión está
 * autenticado contra la API de 42, y eso es más fuerte que estar replicado.
 *
 * `available === true && location !== null` es la regla de guardia: estar
 * disponible sin puesto en el cluster no cuenta, porque no se puede emparejar.
 * No hace falta comprobarla aquí; vive en `onDuty` del front, que es la que
 * manda según `AGENTS.md`.
 */

import type { AvailabilityRepository } from '../db/repositories/availability.js'
import { domainError } from '../domain/errors.js'
import type { AvailabilityResponse } from '../domain/types.js'

export function createAvailabilityService(availability: AvailabilityRepository) {
  return {
    /**
     * Marca o desmarca la disponibilidad de una persona.
     *
     * @throws {DomainError} 400 si no llega un booleano.
     */
    async set(login: string, available: unknown): Promise<AvailabilityResponse> {
      if (typeof available !== 'boolean') {
        throw domainError('invalid_input', 'El campo `available` tiene que ser un booleano')
      }

      await availability.set(login, available)

      return { available }
    },

    /**
     * Disponibilidad guardada de una persona.
     *
     * Si nunca se ha marcado, se devuelve `false` en vez de un 404: acaba de
     * entrar y no ha tocado el toggle, y un error en pantalla para eso sería
     * peores que un "no disponible" honesto.
     */
    async get(login: string): Promise<AvailabilityResponse> {
      return { available: await availability.get(login) }
    },

    /** Cuándo se marcó por última vez, o `undefined` si nunca se ha hecho. */
    async updatedAt(login: string): Promise<string | undefined> {
      return availability.getUpdatedAt(login)
    },
  }
}

export type AvailabilityService = ReturnType<typeof createAvailabilityService>