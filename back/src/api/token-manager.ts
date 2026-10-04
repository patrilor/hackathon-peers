/**
 * Gestión del token de Client Credentials.
 *
 * El token de la app sirve para los endpoints públicos (proyectos, campus,
 * participantes). El de usuario, para `/v2/me`: ese va en el flow OAuth y lo
 * gestiona el módulo de sesión, no este.
 *
 * Dos detalles que importan:
 *
 * 1. **Margen de refresco.** Un token que caduca a mitad de una sincronización
 *    provoca un 401 y obliga a repetir peticiones. Se refresca antes de tiempo.
 *
 * 2. *Single-flight*. Si llegan diez llamadas a la vez y el token caducó, sin
 *    esto se pedirían diez tokens. Y cada token es una petición a la API, que
 *    también cuenta para el rate limit.
 */

import { apiErrorFromNetwork, apiErrorFromResponse, ApiError } from './errors.js'

/** Cuerpo que devuelve `POST /oauth/token`. */
export type TokenResponseBody = {
  access_token: string
  token_type: string
  /**
   * Segundos de validez. Opcional a propósito: el código está preparado para
   * que la API lo omita, y declararlo obligatorio mentiría sobre eso.
   */
  expires_in?: number
  scope?: string
  refresh_token?: string
  resource_owner_id?: number | null
}

/** Margen antes de la expiración para renovar, en milisegundos. */
const DEFAULT_REFRESH_MARGIN_MS = 60_000

export type TokenManagerOptions = {
  /** URL de `POST /oauth/token`. */
  tokenUrl: string
  /** Client ID de la aplicación. */
  uid: string
  /** Client Secret de la aplicación. */
  secret: string
  /** `User-Agent` obligatorio: sin él la API responde 403 con el cuerpo vacío. */
  userAgent: string
  /** Margen de refresco. Por defecto 60 s. */
  refreshMarginMs?: number
  /** Reloj inyectable, para testear el caducado sin esperar. */
  now?: () => number
  /** `fetch` inyectable, para los tests de integración. */
  fetchImpl?: typeof fetch
}

/** Token en memoria con su momento de caducidad. */
type CachedToken = {
  accessToken: string
  /** Marca de tiempo en ms a partir de la cual ya no vale. */
  expiresAt: number
}

export class TokenManager {
  private readonly tokenUrl: string
  private readonly uid: string
  private readonly secret: string
  private readonly userAgent: string
  private readonly refreshMarginMs: number
  private readonly now: () => number
  private readonly fetchImpl: typeof fetch

  private cached: CachedToken | null = null

  /** Petición de token en curso, para que otras esperen a la misma. */
  private inFlight: Promise<string> | null = null

  constructor(options: TokenManagerOptions) {
    this.tokenUrl = options.tokenUrl
    this.uid = options.uid
    this.secret = options.secret
    this.userAgent = options.userAgent
    this.refreshMarginMs = options.refreshMarginMs ?? DEFAULT_REFRESH_MARGIN_MS
    this.now = options.now ?? Date.now
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  /**
   * Devuelve un token válido, pidiéndolo solo si hace falta.
   *
   * Nunca lanza por un token ya válido: si hay uno en caché y no está por
   * caducar, se devuelve y punto.
   */
  async getToken(): Promise<string> {
    const valid = this.cached
    if (valid !== null && !this.isExpiring(valid)) {
      return valid.accessToken
    }

    // Si ya hay una petición en curso, se espera a esa en vez de lanzar otra.
    this.inFlight ??= this.requestToken().finally(() => {
      this.inFlight = null
    })

    return this.inFlight
  }

  /**
   * Descarta el token en caché.
   *
   * Se llama cuando la API responde 401: puede que el token se haya revocado
   * antes de tiempo, y reintentarlo con el mismo no arregla nada.
   */
  invalidate(): void {
    this.cached = null
  }

  /** Token guardado, o `null`. Solo para tests y diagnóstico. */
  peek(): CachedToken | null {
    return this.cached
  }

  /** ¿Caduca dentro del margen de refresco? */
  private isExpiring(token: CachedToken): boolean {
    return token.expiresAt - this.refreshMarginMs <= this.now()
  }

  /** Hace el `POST /oauth/token` de verdad y guarda el resultado. */
  private async requestToken(): Promise<string> {
    // Basic auth con `uid:secret`. Se construye aquí y no se guarda en ningún
    // log para no filtrar el secret.
    const basic = Buffer.from(`${this.uid}:${this.secret}`).toString('base64')

    let response: Response
    try {
      response = await this.fetchImpl(this.tokenUrl, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': this.userAgent,
          Accept: 'application/json',
        },
        body: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
      })
    } catch (cause) {
      throw apiErrorFromNetwork('/oauth/token', cause)
    }

    if (!response.ok) {
      const raw = await response.text()
      throw apiErrorFromResponse(response.status, '/oauth/token', raw, response.headers)
    }

    const body = (await response.json()) as TokenResponseBody
    if (typeof body.access_token !== 'string' || body.access_token === '') {
      throw new ApiError('La respuesta de /oauth/token no trae access_token', response.status, {
        endpoint: '/oauth/token',
        code: 'server_error',
      })
    }

    const expiresInMs = (body.expires_in ?? 0) * 1000
    this.cached = {
      accessToken: body.access_token,
      // Si la API no dice `expires_in`, se asume 30 min y se refresca antes.
      expiresAt: this.now() + (expiresInMs > 0 ? expiresInMs : 1_800_000),
    }

    return this.cached.accessToken
  }
}
