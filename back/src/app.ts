/**
 * Montaje del servidor.
 *
 * Se separa del punto de entrada (`server.ts` en local, `src/vercel.ts` más
 * los ficheros de `api/` en Vercel) para poder levantar la app entera en los
 * tests de integración sin abrir un
 * puerto.
 *
 * `buildApp` es `async` porque abrir la base de datos y aplicar las migraciones
 * lo son: `@libsql/client` habla HTTP y no tiene forma síncrona de hacerlo.
 */

import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

import { ApiError } from './api/errors.js'
import { createApiClient } from './api/create-client.js'
import { createAuthService } from './auth/auth-service.js'
import { createOAuthClient } from './auth/oauth-client.js'
import { loadEnv } from './config/env.js'
import type { Env } from './config/env.js'
import { assertSchemaIsCurrent, closeDatabase, openDatabase } from './db/database.js'
import type { Db } from './db/database.js'
import { createServices } from './services/container.js'
import type { Services } from './services/container.js'
import { registerAuthRoutes } from './http/auth-routes.js'
import { registerDataRoutes } from './http/data-routes.js'
import { mapError } from './http/errors.js'

export type BuildOptions = {
  env?: Env
  /** Conexión ya abierta. En los tests, para poder inspeccionarla. */
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

/**
 * CORS con credenciales.
 *
 * Solo hace falta en desarrollo: en producción el front y el back se sirven
 * desde el mismo dominio (`sanatorio-42.vercel.app`), así que no hay nada
 * cruzado. Se mantiene porque en local el front va en `localhost:5173` y el back
 * en `localhost:3000`, y sin esto la cookie de sesión no viaja.
 */
function registerCors(app: FastifyInstance, env: Env): void {
  app.addHook('onRequest', async (request, reply) => {
    // Sin `Vary` las cachés HTTP pueden guardar la respuesta de un origen y
    // servirla a otro.
    reply.header('Vary', 'Origin')

    const origin = request.headers.origin

    // Peticiones sin `Origin` (curl, health checks, SSR) no necesitan CORS y no
    // se ven afectadas.
    if (origin === undefined) {
      return
    }

    if (!env.allowedOrigins.includes(origin)) {
      // Sin cabeceras de CORS el navegador bloquea, que es justo lo que se quiere
      // de un origen que no está en la lista.
      return
    }

    reply.header('Access-Control-Allow-Origin', origin)
    reply.header('Access-Control-Allow-Credentials', 'true')
    reply.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
    reply.header('Access-Control-Allow-Headers', 'Content-Type')
    // Sin esto el navegador deja pasar la respuesta pero oculta las cabeceras
    // propias, y el total de participantes y el aviso de lista parcial llegan al
    // front como si no existieran. Solo pasa cruzando dominio (en local, Vite en
    // 5173 y el back en 3000); en producción comparten dominio, pero es justo en
    // local donde se prueba.
    reply.header(
      'Access-Control-Expose-Headers',
      'X-Total-Participants, X-Peers-Returned, X-Partial',
    )
    reply.header('Access-Control-Max-Age', '600')
  })

  app.options('/*', async (_request, reply) => reply.code(204).send())
}

/**
 * Un solo manejador de errores para toda la app.
 *
 * Lo que no se reconoce aquí se registra entero y al front solo le llega un
 * mensaje genérico: un error interno puede traer rutas de ficheros, SQL o parte
 * de un token.
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
      request.log.debug(
        { endpoint: error.endpoint, code: error.code, status: error.status },
        'error de la API de 42',
      )
    }

    reply.code(mapped.status).send(mapped.body)
  })
}

/** Crea la app completa, sin abrir el puerto. */
export async function buildApp(options: BuildOptions = {}): Promise<BuiltApp> {
  const env = options.env ?? loadEnv()

  const db =
    options.db ??
    (await openDatabase({
      url: env.DATABASE_URL,
      authToken: env.TURSO_AUTH_TOKEN,
    }))

  if (options.db === undefined) {
    await assertSchemaIsCurrent(db)
  }

  const fetchImpl = options.fetchImpl ?? fetch
  const client = createApiClient(env, fetchImpl)

  /**
   * Aviso de que la API de 42 ha fallado.
   *
   * Va a stderr y no al log de Fastify: la app ya está construida y el logger
   * vive dentro. Lo que importa es que quede rastro en algún sitio, porque la
   * web sigue funcionando con datos viejos y sin esto no habría forma de saber
   * que se están sirviendo viejo.
   */
  const avisarUpstreamFallido = (detail: string): void => {
    process.stderr.write(`[42] ${detail}\n`)
  }

  const services = createServices(db, client, {
    peersPageBudget: env.PEERS_PAGE_BUDGET,
    peersTtlSeconds: env.PEERS_TTL_SECONDS,
    userProjectsTtlSeconds: env.USER_PROJECTS_TTL_SECONDS,
    onUpstreamFailure: avisarUpstreamFallido,
  })

  const oauth = createOAuthClient({
    authorizeUrl: `${env.FORTY_TWO_API_BASE}/oauth/authorize`,
    tokenUrl: env.FORTY_TWO_TOKEN_URL,
    clientId: env.FORTY_TWO_UID,
    clientSecret: env.FORTY_TWO_SECRET,
    redirectUri: env.FORTY_TWO_REDIRECT_URI,
    userAgent: env.FORTY_TWO_USER_AGENT,
    scopes: env.oauthScopes,
    fetchImpl,
  })

  const auth = createAuthService({
    oauth,
    secret: env.SESSION_SECRET,
    frontendUrl: env.FRONTEND_URL,
  })

  const app = Fastify({
    logger: options.logger ?? false,
    // En Vercel la función va detrás de un proxy que añade `x-forwarded-for`.
    trustProxy: true,
    // Las cookies van firmadas, así que no hay csrf-token de por medio, pero sí
    // un límite de cuerpo: sin él, un POST gigante se come la memoria.
    bodyLimit: 64 * 1024,
  })

  registerCors(app, env)
  registerErrorHandler(app)

  /** Comprobación de vida. No toca ni la base ni la API de 42. */
  app.get('/health', () => ({ status: 'ok' }))

  /**
   * Comprobación de la base de datos.
   *
   * Separada de `/health` a propósito: en Vercel un health check que va a Turso
   * consume tiempo y cuota en cada visita, y para saber si la web vive no hace
   * falta. Esta es la que hay que mirar cuando alguien dice "no me salen mis
   * proyectos".
   */
  app.get('/health/db', async (_request, reply) => {
    try {
      await db.execute('SELECT 1')
      return { status: 'ok', database: 'ok' }
    } catch (error) {
      logDbError(error)
      return reply.code(503).send({
        status: 'degraded',
        database: 'error',
        error: 'No se pudo conectar con la base de datos',
      })
    }
  })

  registerAuthRoutes(app, {
    auth,
    frontendUrl: env.FRONTEND_URL,
  })

  registerDataRoutes(app, {
    auth,
    projects: services.projects,
    availability: services.availability,
  })

  return {
    app,
    env,
    db,
    services,
    close: async () => {
      await app.close()
      if (options.db === undefined) {
        closeDatabase(db)
      }
    },
  }
}

/** Log mínimo para el fallo de `/health/db`, que no tiene logger a mano. */
function logDbError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`[db] no se pudo consultar la base: ${message}\n`)
}