/**
 * Servicio de autenticación: el ciclo del login completo, sin HTTP.
 *
 * Se puede testear entero sin levantar un servidor ni abrir un navegador. Las
 * rutas se limitan a traducir cookies y redirecciones.
 *
 * ## Sesión sin tabla
 *
 * La sesión vive **dentro de la cookie firmada**, no en la base de datos. Antes
 * la cookie llevaba un identificador opaco y había una tabla `sessions` que lo
 * guardaba; aquí va el perfil (login, nombre y avatar) firmado con HMAC.
 *
 * Lo que se gana:
 *
 * - Una tabla menos. La base se queda con lo que de verdad es dato.
 * - Ninguna consulta por petición. `/auth/me` y las rutas de datos ya no tocan
 *   la base para saber quién eres.
 * - Sin token de 42 que guardar ni que refrescar. El token de usuario solo se
 *   usa durante el login, para llamar a `/v2/me`, y se tira.
 *
 * Lo que se pierde, y hay que decirlo claro: **no se puede revocar una sesión**
 * antes de que caduque. Si alguien copia la cookie, sigue dentro hasta que
 * expire. Para una web de la intra con la vida de 12 h es un riesgo
 * razonable; para algo con datos sensibles no lo sería, y la vuelta atrás es
 * volver a meter la tabla `sessions`.
 */

import type { ApiUser } from '../domain/types.js'
import { avatarUrlOf } from '../domain/avatar.js'
import { domainError } from '../domain/errors.js'
import { createPkcePair } from './oauth-client.js'
import type { OAuthClient } from './oauth-client.js'
import { randomToken, sign, verify } from './signed-cookie.js'

export type AuthServiceOptions = {
  oauth: OAuthClient
  /** Secreto de `SESSION_SECRET`, para firmar. */
  secret: string
  /** Vida de la sesión, en ms. */
  sessionTtlMs?: number
  /** Vida del `state` anti-CSRF, en ms. */
  stateTtlMs?: number
  /** Url a la que se vuelve al terminar el login. */
  frontendUrl: string
  now?: () => number
}

/** Lo que va dentro de la cookie de sesión. */
export type SessionUser = {
  login: string
  /** Nombre para la cabecera. Puede venir `null` si la persona no lo tiene. */
  name: string | null
  /** Avatar ya resuelto a URL, o `null`. */
  image: string | null
}

/** Valor del cookie de estado, ya serializado. */
type StatePayload = {
  state: string
  verifier: string
  createdAt: number
}

const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000
const DEFAULT_STATE_TTL_MS = 10 * 60 * 1000

export function createAuthService(options: AuthServiceOptions) {
  const now = options.now ?? Date.now
  const sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS
  const stateTtlMs = options.stateTtlMs ?? DEFAULT_STATE_TTL_MS

  /** Lo que hay que devolver a `/auth/login`. */
  type LoginStart = {
    redirectUrl: string
    /** Cookie con el `state` firmado, para comparar en el callback. */
    stateCookie: string
  }

  /** Lo que hay que devolver a `/auth/callback`. */
  type LoginResult = {
    login: string
    image: string | null
    /** Cookie de sesión ya firmada. */
    sessionCookie: string
    /** Dónde manda el navegador al terminar. */
    redirectUrl: string
  }

  /**
   * Paso 1: generar `state` y PKCE, y devolver la URL de la 42.
   *
   * El `state` va en una cookie firmada, no en la base: si no vuelve, no hay nada
   * que limpiar, y el navegador lo manda solo al volver a este dominio.
   */
  function startLogin(): LoginStart {
    const state = randomToken()
    const { verifier, challenge } = createPkcePair()

    const payload: StatePayload = { state, verifier, createdAt: now() }
    const stateCookie = sign(
      options.secret,
      Buffer.from(JSON.stringify(payload)).toString('base64url'),
    )

    return {
      redirectUrl: options.oauth.authorizeUrl({ state, pkce: { verifier, challenge } }),
      stateCookie,
    }
  }

  /**
   * Paso 2: canjear el código y abrir sesión.
   *
   * Son dos peticiones a la 42 y ni una más: el canje del código y un
   * `GET /v2/me`. El token de usuario que devuelve el canje se usa para esa
   * llamada y se queda ahí; a partir de ahí todo lo demás va con el token de la
   * aplicación, que es público.
   *
   * @throws {DomainError} 400 si el `state` no cuadra o ha caducado, que es un
   * intento de CSRF o un enlace de login reutilizado.
   */
  async function finishLogin(params: {
    code: string
    state: string
    stateCookie: string | undefined
  }): Promise<LoginResult> {
    const payload = readState(params.stateCookie)

    if (payload === undefined) {
      throw domainError('invalid_input', 'La sesión de login no es válida o ha caducado')
    }

    // Comparación en tiempo constante: un `===` filtraría el `state` válido.
    if (!sameState(payload.state, params.state)) {
      throw domainError('invalid_input', 'El `state` de login no coincide')
    }

    const { profile } = await options.oauth.completeLogin({
      code: params.code,
      verifier: payload.verifier,
    })

    return openSession(profile)
  }

  /**
   * Firma la cookie de sesión con el perfil recién leído.
   *
   * El `expires` va **dentro** del valor firmado, y no solo en el `Max-Age` de la
   * cookie: si solo estuviera en el `Max-Age`, alguien con la clave del servidor
   * (o un descuido al copiar la cookie) podría quitar la caducidad y tener una
   * sesión eterna. Al ir firmado, no se puede tocar sin romper la firma.
   */
  function openSession(profile: ApiUser): LoginResult {
    const user: SessionUser = {
      login: profile.login,
      name: fullNameOf(profile),
      // Se usa el helper de `domain/avatar.ts` y no `image.url`: la API de 42 no
      // tiene ninguna clave `url` en el avatar de los usuarios, así que eso
      // devolvía siempre `null`.
      image: avatarUrlOf(profile.image),
    }

    const expiresAt = now() + sessionTtlMs
    const payload = Buffer.from(JSON.stringify({ ...user, exp: expiresAt })).toString('base64url')

    return {
      login: user.login,
      image: user.image,
      sessionCookie: sign(options.secret, payload),
      redirectUrl: options.frontendUrl,
    }
  }

  /**
   * Persona de la sesión actual, o `undefined` si no hay o caducó.
   *
   * No toca la base de datos: todo lo que hace falta está en la cookie firmada.
   */
  function readSession(sessionCookie: string | undefined): SessionUser | undefined {
    if (sessionCookie === undefined) {
      return undefined
    }

    const raw = verify(options.secret, sessionCookie)

    if (raw === undefined) {
      // Cookie manipulada: no se distingue de una caducada, y no hace falta.
      return undefined
    }

    let parsed: unknown

    try {
      parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    } catch {
      return undefined
    }

    // El `exp` va dentro del mismo payload firmado, así que se valida aquí y no
    // solo con el `Max-Age` de la cookie: el navegador puede ignorar la fecha si
    // alguien manipula la cookie a mano.
    const expiresAt = readExpiresAt(parsed)

    if (expiresAt === undefined) {
      return undefined
    }

    const user = readSessionUser(parsed)

    if (user === undefined || now() > expiresAt) {
      return undefined
    }

    return user
  }

  /**
   * Persona de la sesión actual. Lanza 401 si no hay.
   *
   * Antes devolvía también el `access_token` de la persona. Ya no: el back
   * habla con la 42 con el token de la aplicación, y el de la persona solo hizo
   * falta durante el login.
   */
  function currentUser(sessionCookie: string | undefined): SessionUser {
    const user = readSession(sessionCookie)

    if (user === undefined) {
      throw domainError('unauthenticated', 'No hay sesión iniciada')
    }

    return user
  }

  /**
   * Cierra la sesión.
   *
   * Sin tabla de sesiones no hay nada que borrar en el servidor: basta con
   * vaciar la cookie, y el navegador la tira. Idempotente.
   */
  function logout(): void {
    // Deliberadamente vacío. Ver `logout` en `http/auth-routes.ts`.
  }

  function readState(stateCookie: string | undefined): StatePayload | undefined {
    if (stateCookie === undefined) {
      return undefined
    }

    const raw = verify(options.secret, stateCookie)

    if (raw === undefined) {
      return undefined
    }

    let parsed: unknown

    try {
      parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    } catch {
      return undefined
    }

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('state' in parsed) ||
      !('verifier' in parsed) ||
      !('createdAt' in parsed) ||
      typeof parsed.state !== 'string' ||
      typeof parsed.verifier !== 'string' ||
      typeof parsed.createdAt !== 'number'
    ) {
      return undefined
    }

    if (now() - parsed.createdAt > stateTtlMs) {
      return undefined
    }

    return { state: parsed.state, verifier: parsed.verifier, createdAt: parsed.createdAt }
  }

  return {
    startLogin,
    finishLogin,
    readSession,
    currentUser,
    logout,
    /** Vida de la sesión, para que la ruta ponga el mismo `Max-Age`. */
    sessionTtlMs,
  }
}

/**
 * Lee el perfil de la cookie, validando la forma.
 *
 * Se valida campo a campo porque el valor viene de fuera: alguien podría mandar
 * una cookie firmada correctamente pero con `login` en un sitio raro, y mejor
 * devolver `undefined` que propagar algo que no es una persona.
 */
function readSessionUser(parsed: unknown): SessionUser | undefined {
  if (typeof parsed !== 'object' || parsed === null || !('login' in parsed)) {
    return undefined
  }

  const candidate = parsed as { login?: unknown; name?: unknown; image?: unknown }

  if (typeof candidate.login !== 'string' || candidate.login === '') {
    return undefined
  }

  return {
    login: candidate.login,
    name: typeof candidate.name === 'string' ? candidate.name : null,
    image: typeof candidate.image === 'string' ? candidate.image : null,
  }
}

/**
 * Lee el instante de caducidad del payload de sesión.
 *
 * Va aparte de `readSessionUser` a propósito: son dos comprobaciones
 * independientes, y así una no se pierde al reescribir la otra.
 */
function readExpiresAt(parsed: unknown): number | undefined {
  if (typeof parsed !== 'object' || parsed === null || !('exp' in parsed)) {
    return undefined
  }

  const exp = (parsed as { exp?: unknown }).exp

  // `Number.isFinite` y no solo `typeof`: un `NaN` serializado pasa el `typeof` y
  // haría que `now() > NaN` fuera `false`, es decir, sesión eternal.
  return typeof exp === 'number' && Number.isFinite(exp) ? exp : undefined
}

/**
 * Nombre legible de una persona.
 *
 * `usual_full_name` es lo que la 42 considera su nombre de siempre; si no está,
 * se recurre al nombre y apellidos que trae el propio usuario. La API devuelve
 * cualquiera de los tres en `null` sin avisar, así que se prueban en orden.
 */
function fullNameOf(profile: ApiUser): string | null {
  if (typeof profile.usual_full_name === 'string' && profile.usual_full_name.trim() !== '') {
    return profile.usual_full_name
  }

  const parts = [profile.first_name, profile.last_name].filter(
    (part): part is string => typeof part === 'string' && part.trim() !== '',
  )

  return parts.length > 0 ? parts.join(' ') : null
}

/** Comparación de `state` en tiempo constante. */
function sameState(expected: string, provided: string): boolean {
  if (expected.length !== provided.length) {
    return false
  }

  let diff = 0

  for (let index = 0; index < expected.length; index += 1) {
    // XOR acumula las diferencias sin salir del bucle: comparar y salir en
    // cuanto hay una es justamente lo que filtra el valor byte a byte.
    diff |= expected.charCodeAt(index) ^ provided.charCodeAt(index)
  }

  return diff === 0
}

export type AuthService = ReturnType<typeof createAuthService>