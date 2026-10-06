/**
 * Servicio de proyectos y compañeros.
 *
 * Aquí vive el cambio de fondo del back: **no hay réplica, hay caché**.
 *
 * El diseño anterior replicaba la API entera y sincronizaba antes de cada
 * lectura. Con la API de 42 limitando a 2 peticiones por segundo y el proyecto
 * `2689` teniendo 2 047 participantes (21 páginas), cada visita a la lista de
 * compañeros tardaba más de 10 s y, si la 42 contestaba `503`, directamente se
 * caía.
 *
 * Ahora la lista se arma por partes:
 *
 * 1. Si no hay metadatos del proyecto, se pide la página 1. De ahí sale el total
 *    (`X-Total`) y cuántas páginas hay, y también el nombre del proyecto.
 * 2. Se lee de la caché todo lo que haya.
 * 3. Se descargan **como mucho `peersPageBudget` páginas que falten**, y se
 *    guardan.
 * 4. Se devuelve lo juntado, indicando si está completo.
 *
 * Así una función responde en unos cientos de milisegundos y se va llenando sola
 * conforme el usuario vuelve. Si el plan de Vercel permite funciones largas,
 * basta con subir `PEERS_PAGE_BUDGET` a 21 y la primera respuesta ya sale entera.
 */

import type { CacheRepository } from '../db/repositories/cache.js'
import { peersMetaKey, peersPageKey, userProjectsKey } from '../db/repositories/cache.js'
import type { AvailabilityRepository } from '../db/repositories/availability.js'
import type { FortyTwoClient } from '../api/client.js'
import { domainError } from '../domain/errors.js'
import { avatarUrlOf } from '../domain/avatar.js'
import { PROJECT_STATUS } from '../domain/types.js'
import type { ApiProjectUser, Peer, ProjectStatus, ProjectSummary } from '../domain/types.js'

/** Lo que se guarda en la caché: el peer sin `available`, que es nuestro. */
type CachedPeer = {
  login: string
  image: string | null
  location: string | null
  status: ProjectStatus
}

/** Metadatos de un proyecto, guardados junto a sus páginas. */
type PeersMeta = {
  /** Registros totales, según `X-Total`. */
  total: number
  perPage: number
  pages: number
  /** El nombre sale del propio `project` de la primera entrada. */
  name: string | null
}

export type PeersResult = {
  /** Los accionables, ya ordenados por el back. */
  peers: Peer[]
  /** Participantes totales del proyecto, aunque no los tenhamos todos. */
  totalParticipants: number
  /** `false` cuando aún faltan páginas por bajar. */
  complete: boolean
  /** Páginas que hay en total, y cuántas tenemos. Para diagnóstico. */
  pages: { cached: number; total: number }
}

export type ProjectsServiceOptions = {
  cache: CacheRepository
  /** Para cruzar de golpe todos los `available`, que son nuestro dato. */
  availability: AvailabilityRepository
  client: FortyTwoClient
  /** Páginas nuevas que se descargan como mucho en una petición. */
  peersPageBudget: number
  /** Caducidad de las páginas de peers, en segundos. */
  peersTtlSeconds: number
  /** Caducidad de la lista de proyectos de una persona, en segundos. */
  userProjectsTtlSeconds: number
  /** Aviso de que la 42 ha fallado y se sirve lo que hay. */
  onUpstreamFailure?: (detail: string) => void
}

export function createProjectsService(options: ProjectsServiceOptions) {
  const { cache, client, peersPageBudget } = options

  /** Ids de proyecto válidos: enteros positivos, como los de la 42. */
  function assertValidProjectId(projectId: number): void {
    if (!Number.isInteger(projectId) || projectId <= 0) {
      throw domainError('invalid_input', `El id de proyecto ${projectId} no es válido`)
    }
  }

  /**
   * Saca los metadatos de un proyecto que aún no los tiene en caché.
   *
   * Se pide la página 1, y de paso salen el total, el nombre del proyecto y esa
   * misma página, que se guarda en `stored` para no volver a bajarla.
   *
   * @throws {DomainError} 404 si el proyecto no existe.
   * @throws {ApiError} El error de la 42 si además no queda nada en caché. Una
   *   lista vacía sería peor: parecería que el proyecto no tiene gente.
   */
  async function resolveMeta(
    projectId: number,
    stored: Map<number, CachedPeer[]>,
  ): Promise<PeersMeta> {
    let first: Awaited<ReturnType<typeof client.getProjectParticipantsPage>>

    try {
      first = await client.getProjectParticipantsPage(projectId, 1)
    } catch (error) {
      // Un 404 no se arregla con datos viejos: el proyecto no existe, y fingir
      // que sí solo haría que la gente viera una lista vacía.
      if (isApiStatus(error, 404)) {
        throw domainError('not_found', `El proyecto ${projectId} no existe en 42`)
      }

      // La 42 no responde, pero puede que quede una lista vieja en la caché.
      // Servirla es mejor que un error en pantalla: los puestos del cluster no
      // cambian de hora en hora, y la respuesta lleva `X-Partial` para que el
      // front lo diga.
      const stale = await cache.getStale<PeersMeta>(peersMetaKey(projectId))

      if (stale === undefined) {
        options.onUpstreamFailure?.(
          `participantes del proyecto ${projectId}: ${describe(error)}`,
        )
        throw error
      }

      options.onUpstreamFailure?.(
        `participantes del proyecto ${projectId}: ${describe(error)}. Se sirve la última lista conocida`,
      )

      return stale
    }

    const meta: PeersMeta = {
      total: first.total,
      perPage: first.perPage,
      pages: Math.max(1, Math.ceil(first.total / first.perPage)),
      name: projectNameOf(first.items),
    }

    await cache.set(peersMetaKey(projectId), meta, options.peersTtlSeconds)
    stored.set(1, await rememberPage(projectId, 1, first.items))

    return meta
  }

  /**
   * Descarga una página y la guarda ya recortada.
   *
   * El recorte es la parte importante: la API manda 25 campos por persona
   * (`email`, `phone`, `wallet`, `correction_point`, `data_erasure_date`…) y a
   * nuestra base solo van cuatro. No hay motivo para guardar el resto.
   */
  async function downloadPage(projectId: number, page: number): Promise<CachedPeer[]> {
    const result = await client.getProjectParticipantsPage(projectId, page)
    const peers = trimPage(result.items)

    await cache.set(peersPageKey(projectId, page), peers, options.peersTtlSeconds)

    return peers
  }

  /**
   * Guarda una página que ya se tiene en la mano, sin volver a pedirla.
   *
   * Existe para la página 1: al establecer los metadatos del proyecto la
   * acabamos de traer, y pedirla otra vez serían dos peticiones donde solo
   * hacía falta una.
   */
  async function rememberPage(
    projectId: number,
    page: number,
    items: readonly ApiProjectUser[],
  ): Promise<CachedPeer[]> {
    const peers = trimPage(items)

    await cache.set(peersPageKey(projectId, page), peers, options.peersTtlSeconds)

    return peers
  }

  return {
    /**
     * Proyectos en curso de una persona, para `GET /me/projects`.
     *
     * Cacheado 30 minutos: son una o dos peticiones a la API, pero no hace
     * falta repetirlas en cada recarga de la web.
     *
     * Lista vacía si no tiene ninguno: no es un error, es que todavía no le toca.
     */
    async findInProgressByUser(login: string): Promise<ProjectSummary[]> {
      const cached = await cache.get<ProjectSummary[]>(userProjectsKey(login))
      if (cached !== undefined) {
        return cached
      }

      const entries = await client.getUserProjects(login)
      const projects = toProjectSummaries(entries)

      await cache.set(userProjectsKey(login), projects, options.userProjectsTtlSeconds)

      return projects
    },

    /**
     * Compañeros accionables del proyecto, para `GET /projects/:id/peers`.
     *
     * Solo se devuelven los que sirven para emparejarse: quien está de guardia
     * (disponible **y** con puesto) y quien lo está haciendo ahora mismo. El
     * resto se cuenta pero no se manda, porque el proyecto 2689 tiene 2 047
     * participantes y dibujarlos todos en el navegador no aporta nada.
     *
     * Se excluye a quien pregunta: el front muestra gente con la que emparejarse
     * y uno mismo no es una sugerencia.
     *
     * @throws {DomainError} 404 si el proyecto no existe en la API de 42, y el
     *   error de la API si tampoco hay nada cacheado que servir.
     */
    async findPeers(projectId: number, excludeLogin?: string): Promise<PeersResult> {
      assertValidProjectId(projectId)

      const cached = await cache.get<PeersMeta>(peersMetaKey(projectId))

      const stored = new Map<number, CachedPeer[]>()

      // Los metadatos siempre se acaban teniendo: o estaban en caché, o los saca
      // la página 1, o los saca la última lista conocida. El `throw` del caso
      // sin salida es lo que lo deja claro al compilador.
      const meta: PeersMeta =
        cached ?? (await resolveMeta(projectId, stored))

      const pending: number[] = []
      for (let page = 1; page <= meta.pages; page += 1) {
        if (stored.has(page)) {
          continue
        }

        // `cache.get` devuelve `undefined` tanto si la página no existe como si ha
        // caducado, y en los dos casos hay que volver a bajarla.
        const value = await cache.get<CachedPeer[]>(peersPageKey(projectId, page))
        if (value === undefined) {
          pending.push(page)
        } else {
          stored.set(page, value)
        }
      }

      // Presupuesto: solo se baja una parte de lo que falta. Si la 42 falla, se
      // sirve lo que ya había, que siempre es mejor que un error.
      if (pending.length > 0) {
        const budget = Math.min(peersPageBudget, pending.length)

        for (const page of pending.slice(0, budget)) {
          try {
            stored.set(page, await downloadPage(projectId, page))
          } catch (error) {
            options.onUpstreamFailure?.(
              `participantes del proyecto ${projectId}, página ${page}: ${describe(error)}`,
            )

            // Si esa página estaba cacheada y caducada, sale igualmente: es mejor
            // un compañero de hace una hora que una lista más corta.
            const stale = await cache.getStale<CachedPeer[]>(peersPageKey(projectId, page))

            if (stale !== undefined) {
              stored.set(page, stale)
            }

            // Se para el bucle en vez de seguir a la siguiente página: si la 42
            // ha fallado una vez, es por cuota o por caída, no por esa página
            // concreta, y reintentar gasta más sin mejorar nada.
            break
          }
        }
      }

      const complete = stored.size === meta.pages
      const everyone = [...stored.entries()]
        .sort(([a], [b]) => a - b)
        .flatMap(([, peers]) => peers)

      const availability = await options.availability.mapOfAll()

      const peers = everyone
        .filter((peer) => peer.login !== excludeLogin)
        .map<CandidatePeer>((peer) => ({ ...peer, available: availability.get(peer.login) ?? false }))
        .filter(isActionable)

      return {
        peers,
        totalParticipants: meta.total,
        complete,
        pages: { cached: stored.size, total: meta.pages },
      }
    },

    /** Nombre del proyecto, o `null` si no se ha mirado todavía. */
    async nameOf(projectId: number): Promise<string | null> {
      const meta = await cache.get<PeersMeta>(peersMetaKey(projectId))

      return meta?.name ?? null
    },
  }
}

/** Un peer con su disponibilidad ya cruzada. */
type CandidatePeer = CachedPeer & { available: boolean }

/**
 * Qué merece la pena mandarse al front.
 *
 * La regla de guardia (`available && location != null`) la decide el front en su
 * función `onDuty`, que es la que manda según `AGENTS.md`. Aquí solo se filtra
 * lo que no sirve nunca: quien está disponible sin puesto no se puede emparejar,
 * y quien ya lo aprobó y no está disponible no aporta.
 *
 * Se manda también quien lo está haciendo (`in_progress`) aunque no esté de
 * guardia, porque es el "paciente como tú" con el que quieres agruparte.
 */
function isActionable(peer: CandidatePeer): boolean {
  if (peer.status === PROJECT_STATUS.IN_PROGRESS) {
    return true
  }

  return peer.available && peer.location !== null
}

/**
 * Recorta una página de `projects_users` a lo que de verdad se guarda.
 *
 * Se descartan las entradas sin persona: la API manda alguna, y sin login no
 * hay nada que enseñar.
 */
function trimPage(items: readonly ApiProjectUser[]): CachedPeer[] {
  const peers: CachedPeer[] = []

  for (const entry of items) {
    const peer = toCachedPeer(entry)

    if (peer !== undefined) {
      peers.push(peer)
    }
  }

  return peers
}

/**
 * Convierte una entrada de `projects_users` en lo que guardamos.
 *
 * `undefined` si no hay persona, que es lo único que hace falta descartar.
 */
function toCachedPeer(entry: ApiProjectUser): CachedPeer | undefined {
  const user = entry.user

  if (user === undefined || user === null || typeof user.login !== 'string') {
    return undefined
  }

  return {
    login: user.login,
    image: avatarUrlOf(user.image),
    // `undefined` y `null` se guardan igual a `null`: a los dos "no está en el
    // campus". La diferencia entre "no lo dice" y "dice que no" solo importa al
    // escribir en una tabla de personas, que ya no existe.
    location: user.location ?? null,
    status: toProjectStatus(entry.status),
  }
}

/** La API devuelve más estados de los que nos interesan. */
function toProjectStatus(status: unknown): ProjectStatus {
  return status === PROJECT_STATUS.FINISHED
    ? PROJECT_STATUS.FINISHED
    : PROJECT_STATUS.IN_PROGRESS
}

/** Proyectos únicos en curso de una lista de `projects_users`. */
function toProjectSummaries(entries: readonly ApiProjectUser[]): ProjectSummary[] {
  const byId = new Map<number, ProjectSummary>()

  for (const entry of entries) {
    if (toProjectStatus(entry.status) !== PROJECT_STATUS.IN_PROGRESS) {
      continue
    }

    const project = entry.project
    if (project === undefined || project === null || typeof project.id !== 'number') {
      continue
    }

    // Una persona aparece una vez por proyecto, pero el mismo `id` puede venir
    // repetido en alguna respuesta: se queda el nombre que sí venga.
    if (!byId.has(project.id) && typeof project.name === 'string') {
      byId.set(project.id, { id: project.id, name: project.name })
    }
  }

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** El nombre del proyecto sale del `project` anidado de la primera entrada. */
function projectNameOf(items: readonly ApiProjectUser[]): string | null {
  for (const item of items) {
    if (typeof item.project?.name === 'string' && item.project.name !== '') {
      return item.project.name
    }
  }

  return null
}

/** `true` si el error es de la API y trae ese status. */
function isApiStatus(error: unknown, status: number): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as { status?: unknown }).status === status
  )
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export type ProjectsService = ReturnType<typeof createProjectsService>