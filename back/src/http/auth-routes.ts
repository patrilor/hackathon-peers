/**
 * Rutas de autenticación: login, callback, me y logout.
 *
 * Cada una es pequeña y delgada: si una ruta empieza a tener lógica de
 * negocio, esa lógica va al servicio. Aquí solo hay cookies y redirecciones.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify'

import { DomainError } from '../domain/errors.js'
import type { AuthService } from '../auth/auth-service.js'
import type { UsersService } from '../services/users.js'
import { mapError } from './errors.js'
import {
  OAUTH_STATE_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  clearCookie,
  readCookie,
  serializeCookie,
  setCookies,
} from './cookies.js'

export type AuthRoutesOptions = {
  auth: AuthService
  /** Para leer `{ login, image }` de la réplica local. */
  users: UsersService
  /** A dónde se vuelve al terminar el login, y en caso de fallo. */
  frontendUrl: string
  /** Vida de la cookie de estado, para borrarla con la misma caducidad. */
  stateTtlMs?: number
  sessionTtlMs?: number
}

export function registerAuthRoutes(app: FastifyInstance, options: AuthRoutesOptions) {
  const { auth, users, frontendUrl } = options
  const stateTtlMs = options.stateTtlMs ?? 10 * 60 * 1000
  const sessionTtlMs = options.sessionTtlMs ?? 12 * 60 * 60 * 1000

  function cookieOf(request: FastifyRequest, name: string): string | undefined {
    return readCookie(request.headers.cookie, name)
  }

  /**
   * Cookie que olvida el estado de OAuth.
   *
   * Se recoge en un array y se manda todo de golpe: Fastify reemplaza el
   * `Set-Cookie` anterior en vez de añadirlo, así que mandar dos por separado
   * deja solo una en la respuesta.
   */
  function forgetState(): string {
    return clearCookie(OAUTH_STATE_COOKIE_NAME, { maxAgeMs: 0, path: '/' })
  }

  function sessionCookieHeader(value: string): string {
    return serializeCookie(SESSION_COOKIE_NAME, value, { maxAgeMs: sessionTtlMs, path: '/' })
  }

  /** Front con el motivo del fallo en la query, para poder mostrar un mensaje. */
  function frontWithError(error: string, status: number): string {
    const url = new URL(frontendUrl)
    url.searchParams.set('error', error)
    url.searchParams.set('status', String(status))

    return url.toString()
  }

  /**
   * `GET /auth/login` → a la 42.
   *
   * La cookie de estado va con `SameSite=Lax` y no `Strict`: con `Strict` el
   * navegador no la mandaría al volver de la 42, que es otro origen, y el
   * login fallaría siempre. `Lax` sí la manda en navegaciones de primer nivel,
   * que es justo el caso del callback.
   */
  app.get('/auth/login', async (_request, reply) => {
    const start = auth.startLogin()

    setCookies(reply, [
      serializeCookie(OAUTH_STATE_COOKIE_NAME, start.stateCookie, {
        maxAgeMs: stateTtlMs,
        path: '/',
      }),
    ])

    return await reply.redirect(start.redirectUrl, 302)
  })

  /**
   * `GET /auth/callback` → canje del código y vuelta al front.
   *
   * Un fallo también acaba en el front, con `?error=...`, y no como un 500 en
   * blanco: el usuario viene del navegador y ver JSON sin más no le dice nada.
   */
  app.get<{ Querystring: { code?: string; state?: string } }>(
    '/auth/callback',
    async (request, reply) => {
      const stateCookie = cookieOf(request, OAUTH_STATE_COOKIE_NAME)

      try {
        if (request.query.code === undefined || request.query.state === undefined) {
          throw new DomainError('invalid_input', 'Falta `code` o `state` en el callback')
        }

        const result = await auth.finishLogin({
          code: request.query.code,
          state: request.query.state,
          stateCookie,
        })

        // El estado ya se ha usado: se borra, para que el enlace no sirva dos
        // veces. Y se manda la sesión, en la MISMA respuesta.
        setCookies(reply, [forgetState(), sessionCookieHeader(result.sessionCookie)])

        return await reply.redirect(frontendUrl, 302)
      } catch (error) {
        const mapped = mapError(error)
        request.log.warn({ err: error }, 'fallo en el callback de OAuth')
        setCookies(reply, [forgetState()])

        return await reply.redirect(frontWithError(mapped.body.error, mapped.status), 302)
      }
    },
  )

  /**
   * `GET /auth/me` → la persona de la sesión.
   *
   * 401 sin sesión, tal y como dice `docs/api.md`.
   */
  app.get('/auth/me', async (request, reply) => {
    const sessionCookie = cookieOf(request, SESSION_COOKIE_NAME)

    if (sessionCookie === undefined) {
      throw new DomainError('unauthenticated', 'No hay sesión iniciada')
    }

    // Valida la sesión. Si no está o caducó, `currentUser` lanza 401.
    const { login } = auth.currentUser(sessionCookie)

    // De la réplica local, no del token de 42: así una carga de página no
    // gasta una llamada de la API.
    return reply.send(users.getByLogin(login))
  })

  /** `POST /auth/logout` → borra la sesión. Idempotente. */
  app.post('/auth/logout', async (request, reply) => {
    auth.logout(cookieOf(request, SESSION_COOKIE_NAME))
    reply.header('Set-Cookie', clearCookie(SESSION_COOKIE_NAME, { maxAgeMs: 0, path: '/' }))

    return reply.code(204).send()
  })
}
