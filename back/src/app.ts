/**
 * Montaje del servidor.
 *
 * Se separa de `server.ts` (el punto de entrada) para poder levantar la app
 * entera en los tests de integración sin abrir un puerto.
 */

import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

import { ApiError } from './api/errors.js'
import { createApiClient } from './api/create-client.js'
import { createAuthService } from './auth/auth-service.js'
import { createOAuthClient } from './auth/oauth-client.js'
import { loadEnv } from './config/env.js'
import type { Env } from './config/env.js'
import { assertSchemaIsCurrent, openDatabase } from './db/database.js'
import type { Db } from './db/database.js'
import { createServices } from './services/container.js'
import type { Services } from './services/container.js'
import { createSynchronizer } from './sync/synchronizer.js'
import { registerAuthRoutes } from './http/auth-routes.js'
import { registerDataRoutes } from './http/data-routes.js'
import { mapError } from './http/errors.js'

export type BuildOptions = {
  env?: Env
  db?: Db
  /** `fetch` inyectable, para los tests de integración. */
  fetchImpl?: typeof fetch
  logger?: boolean
}

export type BuiltApp = {
  app: FastifyInstance
  env: Env
  db: Db
  services: Services
  close: () => Promise<void>
}

/** CORS con credenciales, que es lo que hace que la sesión llegue. */
function registerCors(app: FastifyInstance, env: Env): void {
  app.addHook('onRequest', async (request, reply) => {
    // Sin `Vary` las cachés HTTP pueden guardar la respuesta de un origen y
    // servirla a otro.
    reply.header('Vary', 'Origin')

    const origin = request.headers.origin

    // Peticiones sin `Origin` (curl, health checks, SSR) no necesitan CORS y
    // no se ven afectadas.
    if (origin === undefined) {
      return
    }

    if (!env.allowedOrigins.includes(origin)) {
      // Sin cabeceras de CORS el navegador bloquea, que es justo lo que se
      // quiere de un origen que no está en la lista.
      return
    }

    reply.header('Access-Control-Allow-Origin', origin)
    reply.header('Access-Control-Allow-Credentials', 'true')
    reply.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
    reply.header('Access-Control-Allow-Headers', 'Content-Type')
    reply.header('Access-Control-Max-Age', '600')
  })

  app.options('/*', async (_request, reply) => reply.code(204).send())
}

/**
 * Un solo manejador de errores para toda la app.
 *
 * Lo que no se reconoce aquí se registra entero y al front solo le llega un
 * mensaje genérico: un error interno puede traer rutas de ficheros, SQL o
 * parte de un token.
 */
function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const mapped = mapError(error)

    if (mapped.status >= 500) {
      request.log.error({ err: error }, 'error no controlado')
    } else {
      request.log.warn({ err: error }, 'error de cliente')
    }

    if (error instanceof ApiError) {
      request.log.debug({ endpoint: error.endpoint, code: error.code }, 'error de la API de 42')
    }

    reply.code(mapped.status).send(mapped.body)
  })
}

/** Crea la app completa, sin abrir el puerto. */
export function buildApp(options: BuildOptions = {}): BuiltApp {
  const env = options.env ?? loadEnv()
  const db = options.db ?? openDatabase(env.DATABASE_PATH)

  if (options.db === undefined) {
    assertSchemaIsCurrent(db)
  }

  const services = createServices(db, env.CAMPUS_ID)
  const fetchImpl = options.fetchImpl ?? fetch

  const oauth = createOAuthClient({
    authorizeUrl: `${env.FORTY_TWO_API_BASE}/oauth/authorize`,
    tokenUrl: env.FORTY_TWO_TOKEN_URL,
    clientId: env.FORTY_TWO_UID,
    clientSecret: env.FORTY_TWO_SECRET,
    redirectUri: env.FORTY_TWO_REDIRECT_URI,
    userAgent: env.FORTY_TWO_USER_AGENT,
    fetchImpl,
  })

  const auth = createAuthService({
    db,
    users: services.repositories.users,
    oauth,
    secret: env.SESSION_SECRET,
    frontendUrl: env.FRONTEND_URL,
  })

  const client = createApiClient(env, fetchImpl)
  const synchronizer = createSynchronizer({
    services,
    client,
    campusId: env.CAMPUS_ID,
  })

  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: true,
    // Las cookies van firmadas, así que no hay csrf-token de por medio, pero sí
    // un límite de cuerpo: sin él, un POST gigante se come la memoria.
    bodyLimit: 64 * 1024,
  })

  registerCors(app, env)
  registerErrorHandler(app)

  /** Comprobación de vida. No toca nada: ni sesión ni base de datos. */
  app.get('/health', () => ({ status: 'ok' }))

  registerAuthRoutes(app, {
    auth,
    users: services.users,
    frontendUrl: env.FRONTEND_URL,
  })

  registerDataRoutes(app, {
    auth,
    projects: services.projects,
    availability: services.availability,
    // Sincronizar antes de leer mantiene la réplica al día sin que el front
    // tenga que pedir nada. Los checkpoints hacen que solo se llame a la API
    // cuando de verdad hace falta.
    refresh: async (login: string) => {
      const results = await synchronizer.syncEverythingFor(login)
      const fallo = results.find((result) => result.outcome === 'failed')

      if (fallo !== undefined) {
        avisarSyncFallido(fallo.detail)
      }
    },
  })

  // Sesiones caducadas: se limpian al arrancar para que la tabla no crezca.
  auth.purgeExpiredSessions()

  return {
    app,
    env,
    db,
    services,
    close: async () => {
      await app.close()
      if (options.db === undefined) {
        db.close()
      }
    },
  }
}

/**
 * Aviso de sincronización fallida.
 *
 * A stderr y no al log de Fastify: la app ya está construida y el logger vive
 * dentro. Lo que importa aquí es que quede rastro en algún sitio.
 */
function avisarSyncFallido(detail: string | undefined): void {
  process.stderr.write(`[sync] ${detail ?? 'paso fallido'}\n`)
}
