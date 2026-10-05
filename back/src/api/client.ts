/**
 * Cliente de la API de 42.
 *
 * Una sola puerta de entrada a la API: aquí viven el token, el rate limit, los
 * reintentos, los timeouts y la paginación. El resto del backend solo ve
 * funciones tipadas, y ninguna hace `fetch` directamente.
 *
 * Los endpoints que usamos y sus rarezas, todas verificadas contra la API real:
 *
 * | Endpoint                                | Particularidad                        |
 * |-----------------------------------------|---------------------------------------|
 * | `/v2/me`                                | Necesita token de **usuario** y scope de identidad (`profile`). Con token de app devuelve 404. |
 * | `/v2/users/:login/projects_users`       | Trae el estado por proyecto. No trae el nombre del proyecto. |
 * | `/v2/projects/:id/users`                | Participantes de todo el histórico. No trae estado. |
 * | `/v2/users/:login`                      | Trae `location`: el puesto actual, o `null`. |
 * | `/v2/campus/:id/locations`              | DESCARTADO: histórico completo, inviable. Ver `getUser`. |
 * | `/v2/campus/:id/projects/:pid/users`    | No existe (404). Por eso no se usa.   |
 * | `?filter[login]=a,b,c`                  | Funciona, pero no resuelve el estado. |
 */

import type { RateLimiter } from './rate-limiter.js'
import { TokenManager } from './token-manager.js'
import { ApiError, apiErrorFromNetwork, apiErrorFromResponse, endpointFromUrl } from './errors.js'
import type { ApiProjectUser, ApiUser } from '../domain/types.js'

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
  /** Limitador compartido por todas las peticiones del proceso. */
  limiter: RateLimiter
  /** Gestor del token de la aplicación. */
  tokens: TokenManager
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
  /** Inyectable en los tests: si devuelve token, se usa ese. */
  tokenProvider?: () => Promise<string>
}

/** Peticiones a `/v2/...`. */
type V2Options = {
  /** Timeout propio, para los endpoints lentos. */
  timeoutMs?: number
}

const DEFAULT_MAX_RETRIES = 3
const DEFAULT_BACKOFF_BASE_MS = 500
const DEFAULT_BACKOFF_MAX_MS = 30_000

export class FortyTwoClient {
  private readonly apiV2Base: string
  private readonly userAgent: string
  private readonly timeoutMs: number
  private readonly pageSize: number
  private readonly limiter: RateLimiter
  private readonly tokens: TokenManager
  private readonly fetchImpl: typeof fetch
  private readonly maxRetries: number
  private readonly backoffBaseMs: number
  private readonly backoffMaxMs: number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly tokenProvider: (() => Promise<string>) | null

  constructor(options: FortyTwoClientOptions) {
    this.apiV2Base = options.apiV2Base
    this.userAgent = options.userAgent
    this.timeoutMs = options.timeoutMs
    this.pageSize = options.pageSize
    this.limiter = options.limiter
    this.tokens = options.tokens
    this.fetchImpl = options.fetchImpl ?? fetch
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
    this.backoffBaseMs = options.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS
    this.backoffMaxMs = options.backoffMaxMs ?? DEFAULT_BACKOFF_MAX_MS
    this.sleep = options.sleep ?? defaultSleep
    this.tokenProvider = options.tokenProvider ?? null
  }

  // --- Endpoints ----------------------------------------------------------

  /**
   * `GET /v2/me`: el usuario del token.
   *
   * Exige token de **usuario** y scope de identidad (`profile`). Con el token de la aplicación
   * la API responde `404 {}`, no un 403, lo que desconcierta. Se deja el
   * parámetro para poder pasar un token de usuario cuando el flow OAuth esté.
   *
   * @param accessToken Token de usuario. Si se omite, usa el de la app.
   */
  async getMe(accessToken?: string): Promise<ApiUser> {
    return this.requestV2<ApiUser>('/me', { accessToken })
  }

  /**
   * `GET /v2/projects`: el catálogo con id y nombre de cada proyecto.
   *
   * `projects_users` solo trae `project: { id }`, sin nombre, y el front
   * necesita el nombre para pintar la lista. Sin este catálogo, la tabla
   * `projects` quedaría vacía y las claves foráneas no dejarían guardar
   * ninguna pertenencia.
   */
  async getProjectCatalog(): Promise<
    readonly { id: number; name: string; slug?: string | null }[]
  > {
    return this.fetchAllPages<{ id: number; name: string; slug?: string | null }>('/projects')
  }

  /**
   * `GET /v2/users/:login/projects_users`: el estado en cada proyecto.
   *
   * Es la única fuente de `in_progress` / `finished` que usa Sanatorio. Nótese
   * que cada elemento trae `project: { id }` pero no el nombre, así que el
   * catálogo de nombres hay que sacarlo de otro sitio.
   */
  async getUserProjects(login: string): Promise<ApiProjectUser[]> {
    return this.fetchAllPages<ApiProjectUser>(`/users/${encodeURIComponent(login)}/projects_users`)
  }

  /**
   * `GET /v2/projects/:id/users`: quienes han pasado por el proyecto.
   *
   * Incluye gente que lo aprobó hace años. No trae estado, así que por sí solo
   * no sirve para separar pacientes de especialistas.
   */
  async getProjectParticipants(projectId: number): Promise<ApiUser[]> {
    return this.fetchAllPages<ApiUser>(`/projects/${projectId}/users`)
  }

  /**
   * `GET /v2/campus/:id/users`: el censo del campus.
   *
   * Solo sirve para descubrir personas, no para saber dónde están: este
   * endpoint no trae `location`. La ubicación se pide con `getUser`.
   */
  async getCampusUsers(campusId: number): Promise<ApiUser[]> {
    return this.fetchAllPages<ApiUser>(`/campus/${campusId}/users`)
  }

  /**
   * `GET /v2/users/:login`: el perfil público, con su ubicación actual.
   *
   * Esta es la única fuente de ubicaciones que usamos. Se comprobó que para
   * Madrid `GET /v2/campus/:id/locations` devuelve `X-Total: 751 077`, que es
   * el histórico de todos los puestos desde siempre, no solo los de ahora, y
   * que no admite filtro para quedarse con las activos: 7 511 páginas contra
   * una cuota de 1200 peticiones por hora. Por usuario sale infinitamente más
   * barato y además sale el dato fresco.
   */
  async getUser(login: string): Promise<ApiUser> {
    return this.requestV2<ApiUser>(`/users/${encodeURIComponent(login)}`)
  }

  // --- Paginación ---------------------------------------------------------

  /**
   * Recorre todas las páginas de un endpoint y devuelve la lista completa.
   *
   * La API pagina con `?page=n&per_page=m`. No devuelve el total, así que el
   * corte se hace por tamaño: si una página viene con menos elementos de los
   * pedidos, es la última. Con `per_page=100` y menos de 100 elementos se
   * ahorra una petición inútil.
   */
  private async fetchAllPages<T>(path: string, options: V2Options = {}): Promise<T[]> {
    const collected: T[] = []

    for (let page = 1; ; page += 1) {
      const separator = path.includes('?') ? '&' : '?'
      const url = `${this.apiV2Base}${path}${separator}page=${page}&per_page=${this.pageSize}`

      const batch = await this.requestV2<T[]>(url, options)
      collected.push(...batch)

      if (batch.length < this.pageSize) {
        return collected
      }

      // Cinturón de seguridad: si un endpoint devolviera un array gigante sin
      // paginar en algún borde, sin tope esto sería un bucle infinito.
      if (collected.length > MAX_ITEMS) {
        return collected
      }
    }
  }

  // --- Petición -----------------------------------------------------------

  /**
   * Una petición a la API, con reintentos.
   *
   * @param path Ruta ya construida, o URL completa (así la usa la paginación).
   */
  private async requestV2<T>(
    path: string,
    options: V2Options & { accessToken?: string | undefined } = {},
  ): Promise<T> {
    const url = path.startsWith('http') ? path : `${this.apiV2Base}${path}`
    const endpoint = endpointFromUrl(url)
    const timeoutMs = options.timeoutMs ?? this.timeoutMs

    // Cada intento pasa por el limitador: los reintentos también cuentan.
    return this.limiter.run(async () => {
      let lastError: ApiError | null = null

      for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
        const token = options.accessToken ?? (await this.resolveToken())

        try {
          return await this.attemptFetch<T>(url, token, timeoutMs)
        } catch (cause) {
          if (!(cause instanceof ApiError)) {
            throw cause
          }

          lastError = cause

          // Un 401 con token de app no se arregla reintentando. Se descarta el
          // token por si estuviera caducado, pero se da por perdido el intento.
          if (cause.status === 401 && options.accessToken === undefined) {
            this.tokens.invalidate()
          }

          if (!cause.retryable || attempt === this.maxRetries) {
            throw cause
          }

          await this.sleep(this.backoffFor(attempt, cause.retryAfterSeconds))
        }
      }

      // El bucle siempre devuelve o lanza; esto es solo para que el compilador
      // no se queje de una ruta de retorno imposible.
      throw (
        lastError ??
        new ApiError('Petición fallida sin error', 0, {
          endpoint,
          code: 'network_error',
        })
      )
    })
  }

  /** Un intento de `fetch`, con timeout. */
  private async attemptFetch<T>(url: string, token: string, timeoutMs: number): Promise<T> {
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': this.userAgent,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (cause) {
      // `AbortSignal.timeout` lanza un `TimeoutError`. Lo mapeamos al error
      // tipado para que el reintento y los logs lo traten como timeout.
      throw apiErrorFromNetwork(endpointFromUrl(url), cause)
    }

    if (!response.ok) {
      const raw = await response.text()
      throw apiErrorFromResponse(response.status, endpointFromUrl(url), raw, response.headers)
    }

    return (await response.json()) as T
  }

  /** Token a usar: el inyectado en tests o el del gestor. */
  private resolveToken(): Promise<string> {
    return this.tokenProvider?.() ?? this.tokens.getToken()
  }

  /**
   * Cuánto esperar antes del siguiente intento.
   *
   * Si la API mandó `Retry-After`, se hace caso: es ella quien sabe cuándo
   * termina el límite. Si no, backoff exponencial con un tope, porque esperar
   * 2^n sin tope puede pasar de 30 s a 30 minutos.
   */
  private backoffFor(attempt: number, retryAfterSeconds: number | undefined): number {
    if (retryAfterSeconds !== undefined) {
      return Math.min(retryAfterSeconds * 1000, this.backoffMaxMs)
    }
    const exponential = this.backoffBaseMs * 2 ** attempt
    // Un poco de dispersión: si varios sincronizadores fallan a la vez, no
    // vuelven a caer a la vez.
    const jitter = Math.random() * this.backoffBaseMs
    return Math.min(exponential + jitter, this.backoffMaxMs)
  }
}

/** Tope de elementos acumulados al paginar. */
const MAX_ITEMS = 20_000

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
