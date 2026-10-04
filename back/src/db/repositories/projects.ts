/**
 * Repositorio de proyectos y del estado de cada persona en cada proyecto.
 *
 * Aquí vive la lógica que hace que Sanatorio funcione: cruzar "quién está en
 * el campus" con "quién tiene este proyecto en curso o ya lo aprobó". Esa
 * intersección no existe en la API de 42; se calcula sobre la réplica local.
 */

import type { Db } from '../database.js'
import { nowIso } from '../database.js'
import {
  PROJECT_STATUS,
  type ApiProjectUser,
  type Peer,
  type ProjectStatus,
  type ProjectSummary,
} from '../../domain/types.js'

type PeerRow = {
  login: string
  image_url: string | null
  host: string | null
  available: number | null
  status: string
}

type ProjectRow = { id: number; name: string }

type UserProjectRow = { project_id: number; name: string; status: string }

/**
 * Decide si un estado de la API entra en nuestro modelo.
 *
 * La API devuelve muchos más estados (`waiting_to_be_started`, `upcoming`,
 * `suspended`, `canceled`, `trashed`…) y no todos documentados llegan nunca.
 * Solo nos interesan dos: `in_progress` ("lo está haciendo") y `finished`
 * ("ya lo aprobó"). Si no filtramos aquí, un `waiting_to_be_started` aparecería
 * en la lista de peers con un status que el front no sabe interpretar.
 */
export function normalizeStatus(status: string): ProjectStatus | null {
  return status === PROJECT_STATUS.IN_PROGRESS || status === PROJECT_STATUS.FINISHED
    ? status
    : null
}

export function createProjectsRepository(db: Db) {
  const upsertCatalog = db.transaction(
    (projects: readonly { id: number; name: string; slug?: string | null }[]) => {
      const statement = db.prepare(
        `INSERT INTO projects (id, name, slug) VALUES (@id, @name, @slug)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, slug = excluded.slug`,
      )
      for (const project of projects) {
        statement.run({ id: project.id, name: project.name, slug: project.slug ?? null })
      }
    },
  )

  /**
   * Reemplaza los proyectos de una persona por su estado actual.
   *
   * Se borra lo que tenía y se mete lo que trae la API. Es snapshot por
   * persona, que es la unidad por la que sincronizamos: si alguien deja un
   * proyecto, su fila desaparece y con ella desaparece de los peers.
   */
  const replaceForUser = db.transaction(
    (login: string, entries: readonly ApiProjectUser[]) => {
      db.prepare('DELETE FROM user_projects WHERE login = ?').run(login)

      const statement = db.prepare(
        `INSERT INTO user_projects (login, project_id, status, updated_at)
         VALUES (@login, @project_id, @status, @updated_at)
         ON CONFLICT (login, project_id) DO UPDATE SET
           status     = excluded.status,
           updated_at = excluded.updated_at`,
      )

      const updatedAt = nowIso()
      for (const entry of entries) {
        const status = normalizeStatus(entry.status)
        const projectId = entry.project?.id
        // Sin id de proyecto o con un estado que no modelamos, la fila no sirve.
        if (status === null || projectId === undefined) {
          continue
        }
        statement.run({ login, project_id: projectId, status, updated_at: updatedAt })
      }
    },
  )

  return {
    /** Inserta o actualiza el catálogo de proyectos. */
    upsertCatalog(projects: readonly { id: number; name: string; slug?: string | null }[]): void {
      if (projects.length === 0) {
        return
      }
      upsertCatalog(projects)
    },

    /** Reemplaza el estado de una persona en todos sus proyectos. */
    replaceForUser(login: string, entries: readonly ApiProjectUser[]): void {
      replaceForUser(login, entries)
    },

    /**
     * Proyectos **en curso** de una persona.
     *
     * Es lo que devuelve `GET /me/projects`: la pregunta es "en qué proyecto
     * estoy ahora", para luego pedir los peers de ese proyecto. Los ya
     * aprobados no aparecen aquí, aunque sí en la lista de peers.
     */
    findInProgressByUser(login: string): ProjectSummary[] {
      return db
        .prepare<unknown[], ProjectRow>(
          `SELECT p.id, p.name
             FROM user_projects up
             JOIN projects p ON p.id = up.project_id
            WHERE up.login = ? AND up.status = ?
            ORDER BY p.name`,
        )
        .all(login, PROJECT_STATUS.IN_PROGRESS)
    },

    /**
     * Participantes de un proyecto, con su ubicación y su disponibilidad.
     *
     * Devuelve **todos** los que tienen el proyecto en curso o aprobado, no solo
     * los que están de guardia: quien está en el campus pero no ha marcado
     * disponibilidad es un compañero que existe, y el front decide qué
     * mostrar con esos tres campos.
     */
    findPeers(projectId: number, campusId: number): Peer[] {
      const rows = db
        .prepare<unknown[], PeerRow>(
          `SELECT u.login,
                  u.image_url,
                  ul.host,
                  a.available,
                  up.status
             FROM user_projects up
             JOIN users u        ON u.login = up.login
             LEFT JOIN user_locations ul ON ul.login = u.login AND ul.campus_id = @campus_id
             LEFT JOIN availability    a  ON a.login  = u.login
            WHERE up.project_id = @project_id
            ORDER BY u.login`,
        )
        .all({ project_id: projectId, campus_id: campusId })

      return rows.map((row) => ({
        login: row.login,
        image: row.image_url,
        location: row.host,
        // Sin fila en `availability` significa que nunca lo marcó: no está de
        // guardia. Nunca `undefined`, porque el front espera un booleano.
        available: row.available === 1,
        status: row.status as ProjectStatus,
      }))
    },

    /** Comprueba que un proyecto existe en el catálogo. */
    exists(projectId: number): boolean {
      return (
        db.prepare<unknown[], { total: number }>('SELECT COUNT(*) AS total FROM projects WHERE id = ?')
          .get(projectId)?.total ?? 0) > 0
    },

    /** Nombre de un proyecto, o `undefined` si no lo conocemos. */
    findNameById(projectId: number): string | undefined {
      return db
        .prepare<unknown[], ProjectRow>('SELECT id, name FROM projects WHERE id = ?')
        .get(projectId)?.name
    },

    /** Número de participantes con estado válido de un proyecto. */
    countParticipants(projectId: number): number {
      return (
        db
          .prepare<unknown[], { total: number }>(
            'SELECT COUNT(*) AS total FROM user_projects WHERE project_id = ?',
          )
          .get(projectId)?.total ?? 0
      )
    },

    /** Listado auxiliar para tests y diagnóstico. */
    listAllWithUser(): UserProjectRow[] {
      return db
        .prepare<unknown[], UserProjectRow>(
          `SELECT up.project_id, p.name, up.status
             FROM user_projects up
             JOIN projects p ON p.id = up.project_id
            ORDER BY up.login, p.name`,
        )
        .all()
    },
  }
}

export type ProjectsRepository = ReturnType<typeof createProjectsRepository>