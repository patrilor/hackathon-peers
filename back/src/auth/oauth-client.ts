/**
 * Cliente OAuth de 42 (`/oauth/authorize` y `/oauth/token`).
 *
 * Lo justo para el authorization code flow, con PKCE. No se implementa el
 * refresh token porque las sesiones del back tienen su propia caducidad: si la
 * sesión expira, se pide al usuario que entre otra vez, que es lo razonable
 * para una web de la intra.
 */

import { ApiError, apiErrorFromNetwork } from '../api/errors.js'
import type { ApiErrorBody } from '../api/errors.js'
import type { ApiUser } from '../domain/types.js'
import { randomToken, base64url } from './signed-cookie.js'
import { createHash } from 'node:crypto'

export type OAuthClientOptions = {
  authorizeUrl: string
  tokenUrl: string
  clientId: string
  clientSecret: string
  redirectUri: string
  userAgent: string
  /** Scopes que se piden. Por defecto, `DEFAULT_OAUTH_SCOPES`. */
  scopes?: readonly string[]
  fetchImpl?: typeof fetch
}

/**
 * Scopes por defecto de Sanatorio, si el entorno no dice otra cosa.
 *
 * `public` es el default de la API. `profile` es como llama el panel de la app
 * 78735 al scope de datos de usuario ("manage user data"); es el único que
 * habilita `/v2/me`.
 *
 * Ojo: `/oauth/authorize` **no valida el scope antes de autenticar**. Un nombre
 * equivocado no da error en la redirección: falla más tarde, cuando el usuario
 * ya ha escrito su contraseña. Por eso `scopes` llega en las opciones en vez de
 * estar fijo aquí, y se ajusta con `FORTY_TWO_SCOPES`.
 */
export const DEFAULT_OAUTH_SCOPES = ['public', 'profile'] as const

/** Challenge PKCE: `S256`, no `plain`. */
export type PkcePair = {
  verifier: string
  challenge: string
}

/** Genera el par `verifier` / `challenge` de PKCE. */
export function createPkcePair(): PkcePair {
  const verifier = randomToken(64)
  const challenge = base64url(createHash('sha256').update(verifier).digest())

  return { verifier, challenge }
}

export type AuthorizeParams = {
  /** Devuelve donde el navegador debe acabar. */
  redirectUri?: string
  state: string
  pkce?: PkcePair
}

/** Cuerpo de la respuesta de `POST /oauth/token`. */
export type TokenResponse = {
  access_token: string
  token_type: string
  expires_in?: number
  scope?: string
}

/** Sesión de usuario ya canjeada. */
export type OAuthUserSession = {
  accessToken: string
  /** Segundos de validez del token, si la API los dice. */
  expiresInSeconds: number | undefined
  profile: ApiUser
}

export function createOAuthClient(options: OAuthClientOptions) {
  const fetchImpl = options.fetchImpl ?? fetch
  const scopes = options.scopes ?? DEFAULT_OAUTH_SCOPES

  if (scopes.length === 0) {
    throw new Error('No hay ningún scope que pedir en la URL de autorización de 42.')
  }

  /**
   * URL a la que se manda al navegador.
   *
   * `scope` va siempre: sin él la API concede solo `public`, que es
   * justamente lo que hace que `/v2/me` devuelva `404 {}`. Pasarlo aquí no
   * garantiza que la aplicación lo tenga aprobado, pero sin esto no hay nada
   * que aprobar.
   */
  function authorizeUrl(params: AuthorizeParams): string {
    const url = new URL(options.authorizeUrl)

    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', options.clientId)
    url.searchParams.set('redirect_uri', params.redirectUri ?? options.redirectUri)
    url.searchParams.set('scope', scopes.join(' '))
    url.searchParams.set('state', params.state)

    if (params.pkce !== undefined) {
      url.searchParams.set('code_challenge', params.pkce.challenge)
      url.searchParams.set('code_challenge_method', 'S256')
    }

    return url.toString()
  }

  /** Canjea el código por un token. */
  async function exchangeCode(params: { code: string; verifier?: string }): Promise<TokenResponse> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      client_id: options.clientId,
      client_secret: options.clientSecret,
      redirect_uri: options.redirectUri,
    })

    if (params.verifier !== undefined) {
      body.set('code_verifier', params.verifier)
    }

    return tokenRequest(body)
  }

  async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
    let response: Response

    try {
      response = await fetchImpl(options.tokenUrl, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(
            `${options.clientId}:${options.clientSecret}`,
          ).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': options.userAgent,
        },
        body: body.toString(),
      })
    } catch (cause) {
      throw apiErrorFromNetwork('/oauth/token', cause)
    }

    if (!response.ok) {
      const raw = await response.text()

      throw new ApiError(`El canje del código falló con ${response.status}`, response.status, {
        endpoint: '/oauth/token',
        body: safeJson(raw),
      })
    }

    const parsed: unknown = await response.json()

    if (typeof parsed !== 'object' || parsed === null || !('access_token' in parsed)) {
      throw new ApiError('La respuesta de /oauth/token no trae access_token', response.status, {
        endpoint: '/oauth/token',
      })
    }

    return parsed as TokenResponse
  }

  /**
   * Perfil del usuario con su token de usuario.
   *
   * Aquí es donde se ve si el scope de identidad está de verdad aprobado: con
   * solo `public` la API responde `404 {}` y no dice por qué. Ojo que este `404`
   * es ambiguo: también sale si el token es de Client Credentials, que es justo
   * lo que pasa si alguien salta el paso del canje.
   */
  async function fetchProfile(accessToken: string): Promise<ApiUser> {
    const url = new URL('/v2/me', options.tokenUrl.replace(/\/oauth\/token$/, ''))

    let response: Response

    try {
      response = await fetchImpl(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          'User-Agent': options.userAgent,
        },
      })
    } catch (cause) {
      throw apiErrorFromNetwork('/v2/me', cause)
    }

    if (!response.ok) {
      const raw = await response.text()

      throw new ApiError(
        response.status === 404
          ? 'La API no reconoce el token de usuario. Comprueba que la aplicación tenga aprobado un scope de identidad además de `public` (FORTY_TWO_SCOPES) y que el token sea de usuario, no de la aplicación.'
          : `No se pudo leer el perfil con ${response.status}`,
        response.status,
        { endpoint: '/v2/me', body: safeJson(raw) },
      )
    }

    const parsed: unknown = await response.json()

    if (typeof parsed !== 'object' || parsed === null) {
      throw new ApiError('El perfil de /v2/me no es un objeto', response.status)
    }

    return parsed as ApiUser
  }

  /** Login canjeado y perfil leído, que es lo que el callback necesita. */
  async function completeLogin(params: {
    code: string
    verifier?: string
  }): Promise<OAuthUserSession> {
    const token = await exchangeCode(params)
    const profile = await fetchProfile(token.access_token)

    return {
      accessToken: token.access_token,
      expiresInSeconds: token.expires_in,
      profile,
    }
  }

  return { authorizeUrl, exchangeCode, fetchProfile, completeLogin }
}

/**
 * Cuerpo de error de la API, si se puede leer como JSON.
 *
 * La 42 responde a veces con HTML o texto plano; en ese caso se devuelve
 * `undefined` y el error se queda sin cuerpo, que es mejor que reventar.
 */
function safeJson(raw: string): ApiErrorBody | undefined {
  try {
    const parsed: unknown = JSON.parse(raw)

    if (typeof parsed !== 'object' || parsed === null) {
      return undefined
    }

    return parsed
  } catch {
    return undefined
  }
}

export type OAuthClient = ReturnType<typeof createOAuthClient>
