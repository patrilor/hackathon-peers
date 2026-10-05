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
  LOCATION_MAX_AGE_MS,
  PROJECT_STATUS,
  type ApiProjectUser,
  type Peer,
  type ProjectStatus,
  type ProjectSummary,
} from '../../domain/types.js'

type PeerRow = {
  login: string
  image_url: string | null
  current_location: string | null
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
  return status === PROJECT_STATUS.IN_PROGRESS || status === PROJECT_STATUS.FINISHED ? status : null
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
  /** ¿El catálogo conoce este proyecto? */
  const knownProject = db.prepare('SELECT 1 AS ok FROM projects WHERE id = ?')

  function isKnownProject(projectId: number): boolean {
    return knownProject.get(projectId) !== undefined
  }

  const replaceForUser = db.transaction((login: string, entries: readonly ApiProjectUser[]) => {
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
      // `user_projects` tiene clave foránea contra `projects`. Si el catálogo
      // no conoce este id, se salta SOLO esta entrada. Dejar que reviente la
      // clave abortaría la transacción y perderíamos también los proyectos
      // buenos de esa persona. Un proyecto archivado no sale en `/projects`
      // y eso es justo lo que pasa con la gentecuyo ya lo aprobó hace años.
      if (!isKnownProject(projectId)) {
        continue
      }
      statement.run({ login, project_id: projectId, status, updated_at: updatedAt })
    }
  })

  /**
   * Registra a alguien como participante de un proyecto, sin tocar lo que ya
   * se sepa de esa persona.
   *
   * `GET /projects/:id/users` no trae estado: solo dice que alguien pasó por
   * el proyecto, sin decir si lo está haciendo o si ya lo aprobó. Por eso
   * asumen `in_progress` y **no** se pisa una fila existente. Si `projects_users`
   * ya dijo que esa persona lo tiene terminado, esa información es más fina y
   * manda; esta llamada solo sirve para descubrir gente que aún no conhece-
   * mos de nadie.
   */
  const addParticipants = db.transaction((projectId: number, logins: readonly string[]) => {
    const statement = db.prepare(
      `INSERT INTO user_projects (login, project_id, status, updated_at)
         VALUES (@login, @project_id, 'in_progress', @updated_at)
         ON CONFLICT (login, project_id) DO NOTHING`,
    )

    if (!isKnownProject(projectId)) {
      return
    }

    const updatedAt = nowIso()

    for (const login of logins) {
      statement.run({ login, project_id: projectId, updated_at: updatedAt })
    }
  })

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
     * Añade participantes de un proyecto sin sobrescribir estados conocidos.
     *
     * A diferencia de `replaceForUser`, no borra nada: esta llamada es
     * incompleta y no debe borrar lo que ya sabemos.
     */
    addParticipants(projectId: number, logins: readonly string[]): void {
      if (logins.length === 0) {
        return
      }
      addParticipants(projectId, logins)
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
    findPeers(projectId: number): Peer[] {
      // Una ubicación que no se refresca desde hace media hora es un puesto
      // del cluster que alguien ya no ocupa, así que se entrega como desconocida.
      // El corte se compara como texto porque todas las marcas se guardan con el
      // mismo formato ISO UTC (ver `nowIso`).
      const cutoff = new Date(Date.now() - LOCATION_MAX_AGE_MS).toISOString()

      const rows = db
        .prepare<unknown[], PeerRow>(
          `SELECT u.login,
                  u.image_url,
                  CASE WHEN u.location_synced_at >= @cutoff
                       THEN u.current_location
                       ELSE NULL END AS current_location,
                  a.available,
                  up.status
             FROM user_projects up
             JOIN users u        ON u.login = up.login
             LEFT JOIN availability    a  ON a.login  = u.login
            WHERE up.project_id = @project_id
            ORDER BY u.login`,
        )
        .all({ project_id: projectId, cutoff })

      return rows.map((row) => ({
        login: row.login,
        image: row.image_url,
        // Antes era `host` desde `user_locations`; ahora es `current_location`
        // directo de la tabla `users`, y solo si está fresco.
        location: row.current_location,
        // Sin fila en `availability` significa que nunca lo marcó: no está de
        // guardia. Nunca `undefined`, porque el front espera un booleano.
        available: row.available === 1,
        status: row.status as ProjectStatus,
      }))
    },

    /** Comprueba que un proyecto existe en el catálogo. */
    exists(projectId: number): boolean {
      return (
        (db
          .prepare<unknown[], { total: number }>(
            'SELECT COUNT(*) AS total FROM projects WHERE id = ?',
          )
          .get(projectId)?.total ?? 0) > 0
      )
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
