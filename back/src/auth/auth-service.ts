/**
 * Servicio de autenticación: el ciclo del login completo, sin HTTP.
 *
 * Se puede testear entero sin levantar un servidor ni abrir un navegador. Las
 * rutas se limitan a traducir cookies y redirecciones.
 */

import type { ApiUser } from '../domain/types.js'
import { toUserInput } from '../db/repositories/users.js'
import { domainError } from '../domain/errors.js'
import { createPkcePair } from './oauth-client.js'
import type { OAuthClient } from './oauth-client.js'
import { createSessionsRepository } from './sessions.js'
import type { UsersRepository } from '../db/repositories/users.js'
import type { Db } from '../db/database.js'
import { randomToken, sign, verify } from './signed-cookie.js'

export type AuthServiceOptions = {
  db: Db
  /** Para replicar a la persona antes de abrir sesión (FK de `sessions`). */
  users: UsersRepository
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

/** Valor del cookie de estado, ya serializado. */
type StatePayload = {
  state: string
  verifier: string
  createdAt: number
}

const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000
const DEFAULT_STATE_TTL_MS = 10 * 60 * 1000

export function createAuthService(options: AuthServiceOptions) {
  const sessions = createSessionsRepository(options.db)
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
    sessionId: string
    login: string
    image: string | null
    /** Cookie de sesión. */
    sessionCookie: string
    /** Dónde manda el navegador al terminar. */
    redirectUrl: string
  }

  /**
   * Paso 1: generar `state` y PKCE, y devolver la URL de la 42.
   *
   * El `state` va en una cookie firmada, no en la base: si no vuelve, no hay
   * nada que limpiar, y el navegador lo manda solo al volver a este dominio.
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

    const result = await options.oauth.completeLogin({
      code: params.code,
      verifier: payload.verifier,
    })

    const profile: ApiUser = result.profile

    return openSession(profile, result.accessToken, result.expiresInSeconds)
  }

  /**
   * Abre sesión para un perfil ya leído de la API.
   *
   * La persona se replica antes: `sessions` tiene clave foránea contra
   * `users`, y sin esta fila la inserción fallaría.
   */
  function openSession(
    profile: ApiUser,
    accessToken: string,
    expiresInSeconds: number | undefined,
  ): LoginResult {
    options.users.upsertMany([toUserInput(profile)])

    // La sesión no puede vivir más que el token: si el token caduca antes,
    // las llamadas empezarían a fallar con un 401 sin explicación.
    const tokenTtlMs = (expiresInSeconds ?? 0) * 1000
    const ttl = tokenTtlMs > 0 ? Math.min(tokenTtlMs, sessionTtlMs) : sessionTtlMs

    const session = sessions.create(profile.login, {
      accessToken,
      expiresAt: now() + ttl,
    })

    return {
      sessionId: session.sessionId,
      login: session.login,
      image: profile.image?.url ?? null,
      sessionCookie: sign(options.secret, session.sessionId),
      redirectUrl: options.frontendUrl,
    }
  }

  /** Sesión de una cookie, o `undefined` si no hay o caducó. */
  function readSession(sessionCookie: string | undefined) {
    if (sessionCookie === undefined) {
      return undefined
    }

    const sessionId = verify(options.secret, sessionCookie)

    if (sessionId === undefined) {
      // Cookie manipulada: no se distingue de una caducada, y no hace falta.
      return undefined
    }

    return sessions.findValid(sessionId, now())
  }

  /** Persona de la sesión actual. Lanza 401 si no hay. */
  function currentUser(sessionCookie: string | undefined): {
    login: string
    accessToken: string
    sessionId: string
  } {
    const session = readSession(sessionCookie)

    if (session === undefined) {
      throw domainError('unauthenticated', 'No hay sesión iniciada')
    }

    return {
      login: session.login,
      accessToken: session.accessToken,
      sessionId: session.sessionId,
    }
  }

  /** Cierra la sesión. Idempotente: cerrar dos veces no es un error. */
  function logout(sessionCookie: string | undefined): void {
    const session = readSession(sessionCookie)

    if (session !== undefined) {
      sessions.destroy(session.sessionId)
    }
  }

  /** Limpieza de las caducadas. Se llama al arrancar. */
  function purgeExpiredSessions(): number {
    return sessions.purgeExpired(now())
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
    purgeExpiredSessions,
    sessions,
  }
}

/** Comparación de `state` en tiempo constante. */
function sameState(expected: string, provided: string): boolean {
  if (expected.length !== provided.length) {
    return false
  }

  let diff = 0

  for (let index = 0; index < expected.length; index += 1) {
    // XOR acumula las diferencias sin salir del bucle: comparar y salir
    // en cuanto hay una es justamente lo que filtra el valor byte a byte.
    diff |= expected.charCodeAt(index) ^ provided.charCodeAt(index)
  }

  return diff === 0
}

export type AuthService = ReturnType<typeof createAuthService>
