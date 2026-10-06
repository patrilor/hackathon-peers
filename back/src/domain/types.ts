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
/**
 * Lo que devuelve `GET /auth/me`.
 *
 * Sale de la cookie firmada, no de la base ni de la API de 42, así que recargar
 * la web no cuesta nada.
 */
export type CurrentUser = {
  login: string
  /** Nombre legible, o `null` si la persona no lo tiene en 42. */
  name: string | null
  /** Avatar ya resuelto a URL, o `null`. */
  image: string | null
}

/**
 * Una persona que aparece en `GET /projects/:id/peers`.
 *
 * OJO: la API manda los 2 047 participantes del proyecto 2689, y el back solo
 * devuelve los accionables (de guardia o en curso) más el total en la cabecera
 * `X-Total-Participants`. Esta es la forma de cada uno de los que sí llegan.
 */
export type Peer = {
  login: string
  image: string | null
  /**
   * Puesto en el cluster (`"c2r17s2"`), o `null` si no está en el campus.
   *
   * `null` significa dos cosas a propósito: que la persona no está en el campus,
   * o que sí lo estaba pero hace tanto que no nos fiamos. Un puesto del cluster
   * caduca en cuanto alguien se levanta, así que preferimos no afirmarlo antes
   * que mentir. Ver `LOCATION_MAX_AGE_MS`.
   */
  location: string | null
  /** Lo pone Sanatorio, no la API de 42. */
  available: boolean
  status: ProjectStatus
}

/**
   * Antigüedad máxima de una ubicación para seguir creyéndola.
   *
   * La ubicación no se pide suelta: llega dentro de los participantes de un
   * proyecto, que se cachean 15 minutos (`PEERS_TTL_SECONDS`). Con media hora de
   * margen, un puesto se da por perdido solo si de verdad dejamos de mirar, no
   * por un refresco que aún no tocaba.
   */
export const LOCATION_MAX_AGE_MS = 30 * 60_000

/** Respuesta de `PUT /me/availability`. */
export type AvailabilityResponse = {
  available: boolean
}

/**
 * Avatar de una persona en la API de 42.
 *
 * OJO, aquí se equivocó la primera versión: se tipó como `{ url }` y la API no
 * tiene ninguna clave `url` en usuarios. Devuelve `link` (el original) y
 * `versions` con los tamaños. Leer `image.url` daba `undefined` siempre, así que
 * todos los avatares salían a `null` y el front caía a las iniciales. Verificado
 * contra `/v2/users/:login`, `/v2/projects/:id/users` y el `user` anidado de
 * `projects_users`: los tres traen esta misma forma.
 *
 * `link` y cada versión pueden venir a `null` (quién no tiene foto subida), de
 * ahí que todo sea opcional y nullable.
 */
export type ApiUserImage = {
  link?: string | null
  versions?: {
    large?: string | null
    medium?: string | null
    small?: string | null
    micro?: string | null
  } | null
}

/**
 * Qué versión del avatar se guarda.
 *
 * La web enseña el avatar en dos sitios: en la cabecera, a 40 px, y en la lista
 * de compañeros, a 28 y 64 px. `medium` da de sobra para todo eso y pesa mucho
 * menos que el original, que puede ser una foto de móvil de varios megabytes.
 * Los tamaños no están garantizados por la API, así que si `medium` no existe
 * se baja a `small` y de ahí al original, antes que devolver `null`.
 */
export type AvatarSize = 'medium' | 'small' | 'link'

/**
 * Tamaños del avatar, en orden de preferencia: de más pequeño a más grande.
 *
 * Se recorren en este orden y se devuelve el primero que venga de verdad, para
 * no afirmar una foto que la API no tiene.
 */
export const AVATAR_SIZE_ORDER = [
  'medium',
  'small',
  'link',
] as const satisfies readonly AvatarSize[]

/** Persona tal y como la devuelve la API de 42, en los campos que nos importan. */
export type ApiUser = {
  id: number
  login: string
  kind?: string
  image?: ApiUserImage | null
  /** Nombre de siempre. Es lo que muestra la cabecera del front. */
  usual_full_name?: string | null
  /** Nombre y apellidos, por si `usual_full_name` viene a `null`. */
  first_name?: string | null
  last_name?: string | null
  /**
   * Puesto en el cluster (`"c2r17s2"`) en el que está **ahora mismo**, o `null`
   * si no está en el campus. Lo trae `GET /v2/users/:login` y también los
   * objetos de usuario completos que vienen en otros endpoints.
   *
   * La diferencia entre `undefined` y `null` importa: `undefined` es que este
   * endpoint no habla de ubicación, y `null` es que sí habla y dice que no está.
   * Los resúmenes de usuario no lo incluyen, así que no se puede tratar ambos
   * igual al guardar.
   */
  location?: string | null
}

/** Estado de una persona en un proyecto, tal y como viene en `projects_users`. */
export type ApiProjectUser = {
  status: string
  project?: { id: number; name?: string | null; slug?: string | null } | null
  /**
   * La persona, anidada.
   *
   * Solo viene cuando la consulta es **por proyecto**
   * (`GET /v2/projects_users?filter[project_id]=…`): ahí la API la adjunta
   * completa, con `location` y `image` incluidas. En la consulta por login
   * (`GET /v2/users/:login/projects_users`) también viene, así que de hecho se
   * puede leer de las dos, pero el filtro por proyecto es el que lo garantiza.
   *
   * Se declara como `ApiUser` porque es literalmente el mismo objeto de usuario
   * que devuelve `/v2/users/:login`, con su `location` en las mismas
   * condiciones: la clave está presente, el valor puede ser `null`.
   */
  user?: ApiUser | null
}

/** Error de la API de 42 con la forma que devuelve en JSON. */
export type ApiErrorBody = {
  error?: string
  message?: string
  status?: number
}
