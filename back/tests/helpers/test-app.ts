/**
 * Entorno de pruebas para la app entera.
 *
 * Monta un entorno válido, una base en memoria y un proveedor de 42 simulado,
 * para poder levantar la app completa sin red ni ficheros sucios.
 */

import { buildApp } from '../../src/app.js'
import type { BuiltApp } from '../../src/app.js'
import { loadEnv } from '../../src/config/env.js'
import { closeDatabase, openDatabase } from '../../src/db/database.js'
import type { Env } from '../../src/config/env.js'

/** Entorno válido, con lo único que no se puede inventar siendo parametrizado. */
export function makeEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): Env {
  return loadEnv({
    FORTY_TWO_UID: 'u-test',
    FORTY_TWO_SECRET: 's-test',
    SESSION_SECRET: 'secreto-de-sesion-para-pruebas',
    FRONTEND_ORIGINS: 'https://front.test',
    FRONTEND_URL: 'https://front.test',
    FORTY_TWO_REDIRECT_URI: 'https://back.test/api/auth/callback',
    // El ritmo de la API son 2 peticiones por segundo. En los tests eso solo
    // añadiría segundos de espera, así que se deja casi a cero: los tests del
    // `Throttle` ya cubren el retraso con reloj falso.
    MIN_REQUEST_INTERVAL_MS: '0',
    PEERS_TTL_SECONDS: '900',
    USER_PROJECTS_TTL_SECONDS: '1800',
    ...overrides,
  })
}

/** Petición registrada por el proveedor simulado. */
export type Recorded = {
  url: string
  method: string
  body: string
  authorization: string
}

export type ProviderOptions = {
  /** Perfil que devuelve `/v2/me`. */
  profile?: unknown
  /** Status de `/v2/me`. 404 simula el scope de identidad sin aprobar. */
  profileStatus?: number
  /** Status de `/oauth/token`. */
  tokenStatus?: number
  /**
   * Respuesta por endpoint (ruta sin query).
   *
   * El valor es el cuerpo tal cual lo devuelve la API. Para una respuesta que
   * cambia entre llamadas, una función: `() => cuerpo`.
   */
  routes?: Record<string, RouteHandler>
}

/** Lo que devuelve `inject` en una respuesta. */
type InjectResponse = { statusCode: number; body: string; headers: Record<string, unknown> }

/**
 * Cuerpo JSON. Se declara en vez de usar `unknown` porque `unknown | (() => …)`
 * colapsa a `unknown` y el linter avisa, y además `unknown` obligaría a castear
 * en cada respuesta.
 */
type RouteBody = string | number | boolean | null | RouteBody[] | { [key: string]: RouteBody }

type RouteHandler = RouteBody | (() => RouteBody)

/**
 * Cuerpo JSON de una respuesta, ya tipado.
 *
 * `inject().json()` devuelve `any`, y usarlo tal cual dispara media docena de
 * avisos de `no-unsafe-member-access` en cada test. El cast se hace una vez
 * aquí, y los tests usan `json<Peer[]>(...)`.
 */
export function json(response: InjectResponse): unknown {
  return JSON.parse(response.body) as unknown
}

/**
 * Avatar de ejemplo con la forma que devuelve la 42 de verdad: `image` es un
 * objeto con `link` y cuatro tamaños, no una URL suelta.
 */
const AVATAR = {
  link: 'https://img/1.png',
  versions: {
    large: 'https://img/1-large.png',
    medium: 'https://img/1-medium.png',
    small: 'https://img/1-small.png',
    micro: 'https://img/1-micro.png',
  },
}

/** Rutas que la app conoce, para el proveedor simulado. */
const DEFAULT_ROUTES: Record<string, RouteHandler> = {
  '/v2/projects': [{ id: 10, name: 'ft_printf' }],
  '/v2/campus/22/locations': [],
  '/v2/users/albrodri/projects_users': [
    { status: 'in_progress', project: { id: 10, name: 'ft_printf' } },
    { status: 'finished', project: { id: 11, name: 'libft' } },
  ],
  // Los participantes llegan por `projects_users` filtrado, no por
  // `/projects/:id/users`: así cada uno trae su estado en ese proyecto.
  //
  // La 42 devuelve a **todo** el que tiene una fila en ese proyecto, incluida
  // la persona que pregunta, así que aquí también está `albrodri`.
  //
  // `jdoe` está `finished` y sin puesto a propósito: es el que el filtro de
  // accionables tiene que dejar fuera, y así se comprueba sin tener que mirar
  // el cuerpo de la respuesta.
  '/v2/projects_users': [
    {
      status: 'in_progress',
      project: { id: 10, name: 'ft_printf' },
      user: {
        id: 1,
        login: 'albrodri',
        image: AVATAR,
        location: { id: 5, name: 'c2r17s2' },
      },
    },
    {
      status: 'finished',
      project: { id: 10, name: 'ft_printf' },
      user: { id: 2, login: 'jdoe', image: AVATAR, location: null },
    },
    {
      status: 'in_progress',
      project: { id: 10, name: 'ft_printf' },
      user: {
        id: 3,
        login: 'mgomez',
        image: AVATAR,
        location: { id: 7, name: 'c3r7p7' },
      },
    },
  ],
  '/v2/users/albrodri': { id: 1, login: 'albrodri', image: AVATAR },
}

/**
 * Proyectos que "existen" en el proveedor simulado.
 *
 * Los ids que están en `DEFAULT_ROUTES` (10). Cualquier otro da 404, como en la
 * API real.
 */
const KNOWN_PROJECTS = new Set([10])

export function makeProvider(options: ProviderOptions = {}) {
  const requests: Recorded[] = []
  const routes: Record<string, RouteHandler> = { ...DEFAULT_ROUTES, ...options.routes }

  const fetchImpl: typeof fetch = async (input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const url = new URL(raw)
    const body = init?.body
    const headers = init?.headers as Record<string, string> | undefined

    requests.push({
      url: url.toString(),
      method: init?.method ?? 'GET',
      body: typeof body === 'string' ? body : '',
      authorization: headers?.Authorization ?? '',
    })

    if (url.pathname === '/oauth/token') {
      if (options.tokenStatus !== undefined) {
        return new Response(JSON.stringify({ error: 'invalid_grant' }), {
          status: options.tokenStatus,
        })
      }

      return new Response(
        JSON.stringify({
          access_token: 'token-de-usuario',
          token_type: 'bearer',
          expires_in: 3600,
          scope: 'public profile',
        }),
        { status: 200 },
      )
    }

    if (url.pathname === '/v2/me') {
      if (options.profileStatus !== undefined) {
        return new Response('{}', { status: options.profileStatus })
      }

      return new Response(
        JSON.stringify(
          options.profile ?? {
            id: 1,
            login: 'albrodri',
            image: AVATAR,
          },
        ),
        { status: 200 },
      )
    }

    const configured = routes[url.pathname]

    if (configured === undefined) {
      return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 })
    }

    // La API real responde `404` si el filtro apunta a un proyecto que no
    // existe, en vez de devolver una lista vacía. Sin esto, un id equivocado
    // parecería un proyecto sin gente, que es un fallo mucho más difícil de
    // detectar.
    const filter = url.searchParams.get('filter[project_id]')

    if (filter !== null && !KNOWN_PROJECTS.has(Number(filter))) {
      return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 })
    }

    const answer = typeof configured === 'function' ? configured() : configured
    const items = Array.isArray(answer) ? answer : [answer]

    // Cabeceras de paginación y de cuota, como las manda la API de verdad. Sin
    // `X-Total`, el cliente asumiría que una página con 3 elementos es el
    // proyecto entero, y los tests no probarían la paginación.
    return new Response(JSON.stringify(answer), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-total': String(items.length),
        'x-page': url.searchParams.get('page') ?? '1',
        'x-per-page': '100',
        'x-secondly-ratelimit-limit': '2',
        'x-secondly-ratelimit-remaining': '2',
        'x-hourly-ratelimit-limit': '1200',
        'x-hourly-ratelimit-remaining': '1197',
      },
    })
  }

  return { fetchImpl, requests, routes }
}

export type TestApp = BuiltApp & {
  provider: ReturnType<typeof makeProvider>
  /**
   * Login completo, como lo haría un navegador.
   *
   * Devuelve el par `nombre=valor` listo para mandar como cabecera `Cookie`.
   */
  login: () => Promise<string>
}

/**
 * App completa, con `inject` de Fastify.
 *
 * `inject` hace las peticiones por dentro del proceso, sin abrir un puerto:
 * los tests van mil veces más rápido y no hay puertos que colisionen.
 *
 * Es `async` porque abrir la base con `@libsql/client` y aplicar las
 * migraciones lo son; la promesa devuelve la app ya montada y migrada.
 */
export async function makeApp(
  envOverrides: Partial<NodeJS.ProcessEnv> = {},
  providerOptions: ProviderOptions = {},
): Promise<TestApp> {
  const env = makeEnv(envOverrides)
  const provider = makeProvider(providerOptions)

  // Base en memoria A PROPÓSITO. Sin esto, `buildApp` abriría el fichero real
  // `data/sanatorio.db` y todos los tests compartirían el mismo estado: el
  // `available: true` de un test se colaría en otro y los fallos dependerían
  // del orden de ejecución.
  const db = await openDatabase({ url: 'file::memory:' })
  const built = await buildApp({ env, db, fetchImpl: provider.fetchImpl })

  async function login(): Promise<string> {
    const start = await built.app.inject({ method: 'GET', url: '/auth/login' })
    const stateCookie = cookieValue(start.headers['set-cookie'], '__Host-sanatorio_oauth_state')
    const authorize = new URL(String(start.headers.location))
    const state = authorize.searchParams.get('state') ?? ''

    const callback = await built.app.inject({
      method: 'GET',
      url: `/auth/callback?code=codigo&state=${encodeURIComponent(state)}`,
      headers: { cookie: stateCookie },
    })

    if (callback.statusCode !== 302) {
      throw new Error(`el login falló con ${callback.statusCode}: ${callback.body}`)
    }

    return cookieValue(callback.headers['set-cookie'], '__Host-sanatorio_session')
  }

  return {
    ...built,
    provider,
    login,
    close: async () => {
      await built.app.close()
      closeDatabase(db)
    },
  }
}

/**
 * Saca una cookie de un `Set-Cookie` de Fastify.
 *
 * Devuelve el par `nombre=valor` completo, que es lo que hay que mandar en la
 * cabecera `Cookie` de la petición siguiente. Devolver solo el valor hace que el
 * servidor no la encuentre y parece un fallo de sesión.
 */
export function cookieValue(setCookie: unknown, name: string): string {
  const cookies = Array.isArray(setCookie)
    ? setCookie
    : typeof setCookie === 'string'
      ? [setCookie]
      : []

  for (const cookie of cookies) {
    const text = String(cookie)
    const start = text.indexOf(`${name}=`)

    if (start === -1) {
      continue
    }

    return text.slice(start).split(';')[0] ?? ''
  }

  throw new Error(`no se ha encontrado la cookie ${name} en ${JSON.stringify(setCookie)}`)
}

/** Solo el valor, sin el nombre. Para inspeccionar. */
export function cookieValueOnly(setCookie: unknown, name: string): string {
  return cookieValue(setCookie, name).slice(`${name}=`.length)
}
