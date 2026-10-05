/**
 * Puntos de reanudación de la sincronización.
 *
 * Cada paso deja su marca en `sync_state`. Si el proceso se cae a mitad de una
 * vuelta, la siguiente no repite lo que ya terminó, y sobre todo no vuelve a
 * pedir a la 42 lo que ya tiene: cada llamada cuesta cuota, y 1200 por hora se
 * acaban solos.
 */

export type SyncTarget =
  'projects_catalog' | 'user_projects' | 'project_participants'

/** Claves de `sync_state`, una por lo que se puede sincronizar. */
export const syncKeys = {
  /** Catálogo de proyectos. Cambia pocas veces al día. */
  projectsCatalog: (): string => 'sync:projects:catalog',
  /** Proyectos de una persona. */
  userProjects: (login: string): string => `sync:user:${login}:projects`,
  /** Participantes de un proyecto. */
  projectParticipants: (projectId: number): string => `sync:project:${projectId}:participants`,
} as const

/** Qué pasó al intentar sincronizar un paso. */
export type SyncOutcome =
  /** Ya estaba lo bastante fresco: no se ha llamado a la API. */
  | 'skipped_fresh'
  /** Se ha sincronizado y la marca queda actualizada. */
  | 'updated'
  /** Ha fallado. La marca no se toca, así se reintenta la próxima vez. */
  | 'failed'
  /** La API ha dicho que el token no vale: seguir intentand es inútil. */
  | 'aborted_unauthorized'

export type SyncStepResult = {
  target: SyncTarget
  outcome: SyncOutcome
  /** Detalle para el log, nunca mostrado al front. */
  detail?: string
  /** Cuántos elementos se han escrito, cuando tiene sentido. */
  count?: number
  /** Cuánto costó, en ms. */
  durationMs?: number
}
