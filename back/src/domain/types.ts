/**
 * Tipos del dominio de Sanatorio 42.
 *
 * Estos tipos son el espejo exacto de `docs/api.md`. Si alguien cambia el
 * contrato del front, el cambio tiene que empezar por aquí, y los tests lo
 * detectarán.
 */

/** Estado de una persona respecto a un proyecto. */
export const PROJECT_STATUS = {
  /** Lo está haciendo ahora mismo: un "paciente como tú". */
  IN_PROGRESS: 'in_progress',
  /** Ya lo ha aprobado: un "especialista". */
  FINISHED: 'finished',
} as const

export type ProjectStatus = (typeof PROJECT_STATUS)[keyof typeof PROJECT_STATUS]

/** Proyecto tal y como lo devuelve `GET /me/projects`. */
export type ProjectSummary = {
  id: number
  name: string
}

/** Persona tal y como la devuelve `GET /auth/me`. */
export type CurrentUser = {
  login: string
  image: string | null
}

/** Una persona que aparece en `GET /projects/:id/peers`. */
export type Peer = {
  login: string
  image: string | null
  /** Puesto en el cluster (`"c2r17s2"`), o `null` si no está en el campus. */
  location: string | null
  /** Lo pone Sanatorio, no la API de 42. */
  available: boolean
  status: ProjectStatus
}

/** Respuesta de `PUT /me/availability`. */
export type AvailabilityResponse = {
  available: boolean
}

/** Persona tal y como la devuelve la API de 42, en los campos que nos importan. */
export type ApiUser = {
  id: number
  login: string
  kind?: string
  image?: { url?: string } | null
  usual_full_name?: string | null
}

/** Entrada de `/campus/:id/locations` tal y como la devuelve la API. */
export type ApiCampusLocation = {
  host: string | null
  primary?: boolean
  campus_id: number
  user: ApiUser
}

/** Estado de una persona en un proyecto, tal y como viene en `projects_users`. */
export type ApiProjectUser = {
  status: string
  project?: { id: number; name?: string | null; slug?: string | null } | null
}

/** Error de la API de 42 con la forma que devuelve en JSON. */
export type ApiErrorBody = {
  error?: string
  message?: string
  status?: number
}
