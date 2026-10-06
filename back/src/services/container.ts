/**
 * Composición de las dependencias.
 *
 * Un solo sitio donde se decide qué repositorio recibe cada servicio. Lo usan
 * tanto el servidor como los tests, así que no hay dos formas distintas de
 * montar la aplicación.
 */

import type { Db } from '../db/database.js'
import { createAvailabilityRepository } from '../db/repositories/availability.js'
import { createCacheRepository } from '../db/repositories/cache.js'
import type { FortyTwoClient } from '../api/client.js'
import { createAvailabilityService } from './availability.js'
import { createProjectsService } from './projects.js'

/** Lo que el servidor necesita saber para montar los servicios. */
export type ServicesConfig = {
  /** Campus al que se limita la lista de compañeros (22 = Madrid). */
  campusId: number
  /** Páginas de peers que se descargan como mucho en una petición. */
  peersPageBudget: number
  /** Caducidad de las páginas de peers, en segundos. */
  peersTtlSeconds: number
  /** Caducidad de los proyectos de una persona, en segundos. */
  userProjectsTtlSeconds: number
  /** Aviso de que la 42 ha fallado y se está sirviendo lo que había. */
  onUpstreamFailure?: (detail: string) => void
}

export type Services = {
  repositories: {
    availability: ReturnType<typeof createAvailabilityRepository>
    cache: ReturnType<typeof createCacheRepository>
  }
  projects: ReturnType<typeof createProjectsService>
  availability: ReturnType<typeof createAvailabilityService>
}

/** Monta repositorios y servicios sobre una conexión abierta. */
export function createServices(db: Db, client: FortyTwoClient, config: ServicesConfig): Services {
  const repositories = {
    availability: createAvailabilityRepository(db),
    cache: createCacheRepository(db),
  }

  return {
    repositories,
    projects: createProjectsService({
      cache: repositories.cache,
      availability: repositories.availability,
      client,
      campusId: config.campusId,
      peersPageBudget: config.peersPageBudget,
      peersTtlSeconds: config.peersTtlSeconds,
      userProjectsTtlSeconds: config.userProjectsTtlSeconds,
      ...(config.onUpstreamFailure === undefined
        ? {}
        : { onUpstreamFailure: config.onUpstreamFailure }),
    }),
    availability: createAvailabilityService(repositories.availability),
  }
}