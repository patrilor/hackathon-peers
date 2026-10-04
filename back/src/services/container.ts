/**
 * Composición de las dependencias.
 *
 * Un solo sitio donde se decide qué repositorio recibe cada servicio. Lo usan
 * tanto el servidor como el sincronizador, y en los tests, así que no hay dos
 * formas distintas de montar la aplicación.
 */

import type { Db } from '../db/database.js'
import { createAvailabilityRepository } from '../db/repositories/availability.js'
import { createLocationsRepository } from '../db/repositories/locations.js'
import { createProjectsRepository } from '../db/repositories/projects.js'
import { createSyncStateRepository } from '../db/repositories/sync-state.js'
import { createUsersRepository } from '../db/repositories/users.js'
import { createAvailabilityService } from './availability.js'
import { createProjectsService } from './projects.js'
import { createUsersService } from './users.js'

export type CampusId = number

export type Services = {
  repositories: {
    availability: ReturnType<typeof createAvailabilityRepository>
    locations: ReturnType<typeof createLocationsRepository>
    projects: ReturnType<typeof createProjectsRepository>
    syncState: ReturnType<typeof createSyncStateRepository>
    users: ReturnType<typeof createUsersRepository>
  }
  users: ReturnType<typeof createUsersService>
  projects: ReturnType<typeof createProjectsService>
  availability: ReturnType<typeof createAvailabilityService>
}

/** Monta repositorios y servicios sobre una conexión abierta. */
export function createServices(db: Db, campusId: CampusId): Services {
  const repositories = {
    availability: createAvailabilityRepository(db),
    locations: createLocationsRepository(db),
    projects: createProjectsRepository(db),
    syncState: createSyncStateRepository(db),
    users: createUsersRepository(db),
  }

  return {
    repositories,
    users: createUsersService(repositories.users),
    projects: createProjectsService(repositories.projects, { campusId }),
    availability: createAvailabilityService(repositories.availability, repositories.users),
  }
}