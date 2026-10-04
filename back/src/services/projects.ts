/**
 * Servicio de proyectos y compañeros.
 *
 * Sirve las dos rutas de lectura (`/me/projects` y `/projects/:id/peers`) desde
 * la réplica local, sin tocar la API de 42: el front lee y el front es rápido.
 */

import type { ProjectsRepository } from '../db/repositories/projects.js'
import { domainError } from '../domain/errors.js'
import type { Peer, ProjectSummary } from '../domain/types.js'

export type ProjectsServiceOptions = {
  /** Campus cuyos compañeros se muestran. Solo hay uno sincronizado. */
  campusId: number
}

export function createProjectsService(
  projects: ProjectsRepository,
  options: ProjectsServiceOptions,
) {
  /** Ids de proyecto válidos: enteros positivos, como los de la 42. */
  function assertValidProjectId(projectId: number): void {
    if (!Number.isInteger(projectId) || projectId <= 0) {
      throw domainError('invalid_input', `El id de proyecto ${projectId} no es válido`)
    }
  }

  return {
    /**
     * Proyectos en curso de una persona.
     *
     * Lista vacía si aún no hay datos: no es un error, es simplemente que el
     * sincronizador todavía no ha llegado a ese usuario.
     */
    findInProgressByUser(login: string): ProjectSummary[] {
      return projects.findInProgressByUser(login)
    },

    /**
     * Compañeros del proyecto: quien lo tiene en curso y quien ya lo aprobó.
     *
     * Se puede excluir a quien pregunta: el front muestra gente con la que
     * emparejarse, y uno mismo no es una sugerencia.
     *
     * @throws {DomainError} 400 si el id no tiene forma de id, 404 si el
     * proyecto no está en el catálogo replicado.
     */
    findPeers(projectId: number, excludeLogin?: string): Peer[] {
      assertValidProjectId(projectId)

      if (!projects.exists(projectId)) {
        throw domainError('not_found', `El proyecto ${projectId} no está en la réplica local`)
      }

      const peers = projects.findPeers(projectId, options.campusId)

      return excludeLogin === undefined
        ? peers
        : peers.filter((peer) => peer.login !== excludeLogin)
    },

    /** Nombre del proyecto, o `null` si no lo conocemos. */
    nameOf(projectId: number): string | undefined {
      return projects.findNameById(projectId)
    },
  }
}

export type ProjectsService = ReturnType<typeof createProjectsService>
