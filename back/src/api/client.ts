/**
 * Cliente de la API de 42.
 *
 * Una sola puerta de entrada a la API: aquí viven el token, el ritmo, los
 * reintentos, los timeouts y la paginación. El resto del backend solo ve
 * funciones tipadas, y ninguna hace `fetch` directamente.
 *
 * Los endpoints que usamos y sus rarezas, todas verificadas contra la API real:
 *
 * | Endpoint                                | Particularidad                        |
 * |-----------------------------------------|---------------------------------------|
 * | `/v2/projects_users?filter[project_id]` | Participantes **de una página**. Estado **y** persona en la misma llamada. |
 * | `/v2/users/:login/projects_users`       | Los proyectos de una persona.         |
 * | `/v2/me`                                | Necesita token de **usuario** y scope de identidad (`profile`). Va en `auth/oauth-client.ts`, no aquí. |
 * | `/v2/projects`                          | **No se usa.** El catálogo son 1 702 proyectos (18 páginas) y no lo necesita nadie. |
 * | `/v2/projects/:id/users`                | Participantes sin estado. **No se usa.** |
 * | `/v2/campus/:id/locations`              | DESCARTADO: histórico completo, inviable. |
 * | `?filter[project_id]=a,b`               | Solo devuelve los del primer id (comprobado: 100 entradas, todas de `2689`). Un proyecto por petición. |
 *
 * Lo más importante de este cliente es que `getProjectParticipantsPage` devuelve
 * **una página**, no el proyecto entero. La razón está medida: el proyecto
 * `2689` tiene 2 047 participantes, son 21 páginas, y la API va a 2 peticiones
 * por segundo. Bajar el proyecto entero son ~11 s, que no caben en una función
 * de Vercel. Bajando de a una, cada petición dura menos de un segundo y la
 * caché las va guardando (ver `db/repositories/cache.ts`).
 */

import type { AppTokenProvider } from './app-token.js'
import type { Throttle } from './throttle.js'
import { ApiError, apiErrorFromNetwork, apiErrorFromResponse, endpointFromUrl } from './errors.js'
import type { ApiProjectUser } from '../domain/types.js'

/** Configuración del cliente. */
export type FortyTwoClientOptions = {
  /** Raíz de la API v2, con barra final. */
  apiV2Base: string
  /** `User-Agent` de la aplicación. */
  userAgent: string
  /** Timeout de cada petición. */
  timeoutMs: number
  /** Peticiones por página. Máximo de la API: 100. */
  pageSize: number
  /** Ritmo de las peticiones, guiado por las cabeceras de cuota de la API. */
  throttle: Throttle
  /** Token de la aplicación. */
  tokens: AppTokenProvider
  /** `fetch` inyectable, para los tests. */
  fetchImpl?: typeof fetch
  /** Intentos antes de rendirse, sin contar el primero. */
  maxRetries?: number
  /** Base del backoff exponencial, en milisegundos. */
  backoffBaseMs?: number
  /** Tope del backoff, para no esperar minutos. */
  backoffMaxMs?: number
  /** `sleep` inyectable, para no esperar de verdad en los tests. */
  sleep?: (ms: number) => Promise<void>
}

const DEFAULT_MAX_RETRIES = 2
const DEFAULT_BACKOFF_BASE_MS = 500
const DEFAULT_BACKOFF_MAX_MS = 10_000

/** Tope de elementos acumulados al paginar. Cinturón de seguridad. */
const MAX_ITEMS = 20_000

/** Una página de resultados, con los metadatos que manda la API en las cabeceras. */
export type Page<T> = {
  items: T[]
  /** Registros por página que dice la API. */
  perPage: number
  /**
   * Número **total de registros**, no de páginas.
   *
   * La documentación oficial dice lo contrario ("count of pages") pero su propio
   * ejemplo la desmiente: con `X-Total: 17570`, `X-Per-Page: 30` y
   * `rel="last"` apuntando a la página 586. Y 17 570 / 30 redondeado hacia
   * arriba da exactamente 586. Comprobado también con datos reales:
   * `?filter[project_id]=2689&per_page=100` devuelve `X-Total: 2047` y
   * `rel="last"` en la página 21.
   */
  total: number
}

export class FortyTwoClient {
  private readonly apiV2Base: string
  private readonly userAgent: string
  private readonly timeoutMs: number
  private readonly pageSize: number
  private readonly throttle: Throttle
  private readonly tokens: AppTokenProvider
  private readonly fetchImpl: typeof fetch
  private readonly maxRetries: number
  private readonly backoffBaseMs: number
  private readonly backoffMaxMs: number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(options: FortyTwoClientOptions) {
    this.apiV2Base = options.apiV2Base
    this.userAgent = options.userAgent
    this.timeoutMs = options.timeoutMs
    this.pageSize = options.pageSize
    this.throttle = options.throttle
    this.tokens = options.tokens
    this.fetchImpl = options.fetchImpl ?? fetch
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
    this.backoffBaseMs = options.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS
    this.backoffMaxMs = options.backoffMaxMs ?? DEFAULT_BACKOFF_MAX_MS
    this.sleep = options.sleep ?? defaultSleep
  }

  // --- Endpoints ----------------------------------------------------------

  /**
   * `GET /v2/projects_users?filter[project_id]=:id`, **una página**.
   *
   * Es la llamada que alimenta la lista de compañeros, y trae en el mismo objeto
   * y en las mismas peticiones:
   *
   * - `status` — `in_progress` o `finished`. Sin esto no hay manera de
   *   distinguir a un especialista de alguien que lo está haciendo.
   * - `user.location` — el puesto actual en el cluster, o `null`.
   * - `user.image` — el avatar.
   * - `project.name` — el nombre del proyecto.
   *
   * Que el `user` anidado traiga `location` está comprobado: en una página de
   * 100 participantes del proyecto 2689, 11 lo traían con puesto y ninguno lo
   * omitió. Es lo que permite sacar la lista de compañeros con 21 peticiones en
   * vez de 21 más una por persona.
   */
  async getProjectParticipantsPage(projectId: number, page = 1): Promise<Page<ApiProjectUser>> {
    return this.requestPage<ApiProjectUser>(
      `/projects_users?filter[project_id]=${projectId}&page=${page}&per_page=${this.pageSize}`,
    )
  }

  /**
   * `GET /v2/users/:login/projects_users`: los proyectos de una persona.
   *
   * Son una o dos páginas (alguien con 40 proyectos cabe en una de 100), así que
   * aquí sí se recorre entera. De ahí sale `GET /me/projects`.
   */
  async getUserProjects(login: string): Promise<ApiProjectUser[]> {
    return this.fetchAllPages<ApiProjectUser>(`/users/${encodeURIComponent(login)}/projects_users`)
  }

  // --- Paginación ---------------------------------------------------------

  /**
   * Recorre todas las páginas de un endpoint y devuelve la lista completa.
   *
   * El corte es por tamaño: si una página viene con menos elementos de los
   * pedidos, es la última. Con `per_page=100` y menos de 100 elementos se ahorra
   * una petición inútil.
   */
  private async fetchAllPages<T>(path: string): Promise<T[]> {
    const collected: T[] = []

    for (let page = 1; ; page += 1) {
      const separator = path.includes('?') ? '&' : '?'
      const result = await this.requestPage<T>(
        `${path}${separator}page=${page}&per_page=${this.pageSize}`,
      )
      collected.push(...result.items)

      if (result.items.length < this.pageSize || collected.length > MAX_ITEMS) {
        return collected
      }
    }
  }

  /** Una petición que devuelve un array, leyendo los metadatos de las cabeceras. */
  private async requestPage<T>(path: string): Promise<Page<T>> {
    const url = `${this.apiV2Base}${path}`
    const { body, headers } = await this.requestWithRetries(url)

    if (!Array.isArray(body)) {
      throw new ApiError(`${endpointFromUrl(url)} no ha devuelto una lista`, 200, {
        endpoint: endpointFromUrl(url),
        code: 'bad_request',
      })
    }

    return {
      items: body as T[],
      perPage: readInt(headers, 'x-per-page') ?? this.pageSize,
      // Si la API no manda la cabecera, se asume que lo que ha venido es todo.
      total: readInt(headers, 'x-total') ?? (body as T[]).length,
    }
  }

  // --- Petición -----------------------------------------------------------

  /** Una petición con reintentos, que devuelve cuerpo y cabeceras. */
  private async requestWithRetries(url: string): Promise<{ body: unknown; headers: Headers }> {
    const endpoint = endpointFromUrl(url)
    let lastError: ApiError | null = null

    for (let attempt = 0; ; attempt += 1) {
      // Cada intento pasa por el ritmo: los reintentos también cuentan, y saltarse
      // el control aquí convertiría un 503 en un 429.
      await this.throttle.before()

      try {
        const response = await this.fetchOnce(url)

        if (!response.ok) {
          throw apiErrorFromResponse(
            response.status,
            endpoint,
            await response.text(),
            response.headers,
          )
        }

        return { body: await response.json(), headers: response.headers }
      } catch (cause) {
        if (!(cause instanceof ApiError)) {
          throw cause
        }

        lastError = cause

        // Aunque la respuesta sea un error, las cabeceras de cuota vienen igual,
        // y son las que dicen cuándo se podrá volver a pedir.
        if (cause.headers !== undefined) {
          this.throttle.observe(cause.headers)
        }

        // Un 401 con token de app no se arregla reintentando. Se descarta el
        // token por si estuviera caducado, pero se da por perdido el intento.
        if (cause.status === 401) {
          this.tokens.invalidate()
        }

        if (!cause.retryable || attempt >= this.maxRetries) {
          throw cause
        }

        await this.sleep(this.backoffFor(attempt, cause.retryAfterSeconds))
      }
    }

    // El bucle de arriba siempre devuelve o lanza; esto es solo para que el
    // compilador no se queje de una ruta de retorno imposible.
    throw (
      lastError ??
      new ApiError('Petición fallida sin error', 0, { endpoint, code: 'network_error' })
    )
  }

  /** Un intento de `fetch`, con timeout. */
  private async fetchOnce(url: string): Promise<Response> {
    const token = await this.tokens.getToken()

    try {
      const response = await this.fetchImpl(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': this.userAgent,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      })

      this.throttle.observe(response.headers)

      return response
    } catch (cause) {
      // `AbortSignal.timeout` lanza un `TimeoutError`. Lo mapeamos al error
      // tipado para que el reintento y los logs lo traten como timeout.
      throw apiErrorFromNetwork(endpointFromUrl(url), cause)
    }
  }

  /**
   * Cuánto esperar antes del siguiente intento.
   *
   * Si la API mandó `Retry-After`, se hace caso: es ella quien sabe cuándo
   * termina el límite. Si no, backoff exponencial con un tope, porque esperar
   * 2^n sin tope puede pasar de 10 s a horas.
   */
  private backoffFor(attempt: number, retryAfterSeconds: number | undefined): number {
    if (retryAfterSeconds !== undefined) {
      return Math.min(retryAfterSeconds * 1000, this.backoffMaxMs)
    }
    const exponential = this.backoffBaseMs * 2 ** attempt
    // Un poco de dispersión: si varias peticiones fallan a la vez, no se vuelven
    // a caer a la vez.
    const jitter = Math.random() * this.backoffBaseMs

    return Math.min(exponential + jitter, this.backoffMaxMs)
  }
}

/** Lee una cabecera como entero. `undefined` si no está o no es un número. */
function readInt(headers: Headers, name: string): number | undefined {
  const raw = headers.get(name)

  if (raw === null || raw.trim() === '') {
    return undefined
  }

  const parsed = Number(raw)

  return Number.isNaN(parsed) ? undefined : parsed
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}