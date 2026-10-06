/**
 * Puente entre las funciones serverless de Vercel y la app Fastify.
 *
 * En Vercel no hay un puerto que escuchar: cada petición llega como un
 * `Request` de la API web y hay que devolver un `Response`. En vez de
 * reescribir las rutas, la petición se le pasa a Fastify con `app.inject()`,
 * que es el mismo mecanismo que usan sus propios tests: Fastify responde igual
 * que con un puerto real y aquí solo se traslada esa respuesta al formato web.
 *
 * Elegir `inject` en vez de `fastify.server.emit('request', ...)` tiene un
 * motivo concreto: Vercel ya ha leído el cuerpo de la petición antes de llegar
 * aquí, así que el stream está vacío y Fastify lo rechazaría. Con `inject` el
 * cuerpo va explícito (`payload`) y no depende de quién lo haya consumido.
 *
 * El prefijo `/api` existe solo en Vercel (un único proyecto: el front en `/`
 * y el back en `/api`); en local el back escucha las rutas directamente. Por
 * eso se quita aquí, y solo aquí.
 */

import type { InjectOptions, LightMyRequestResponse } from 'fastify'

import { buildApp } from './app.js'
import type { BuiltApp } from './app.js'

/** La app, construida una sola vez por instancia fría. */
let construida: Promise<BuiltApp> | undefined

/**
 * App construida y cacheada.
 *
 * Si la construcción falla (una variable mal puesta, la base inaccesible), la
 * promesa se descarta: si se guardara, cada petición de la instancia fallaría
 * con el mismo error viejo hasta que Vercel la reciclara.
 */
async function appConstruida(): Promise<BuiltApp> {
  construida ??= buildApp().catch((error: unknown) => {
    construida = undefined
    throw error
  })

  return construida
}

/** Prefijo que Vercel pone por delante de las funciones del proyecto. */
const PREFIJO = '/api'

/**
 * La ruta tal como la entiende Fastify, sin el prefijo de Vercel.
 *
 * Se manda el `search` aparte porque solo se toca el pathname: quitar el
 * prefijo con un `replace` a ciegas rompería un `?destino=/api/algo`.
 */
export function rutaSinPrefijo(url: URL): string {
  const ruta = url.pathname

  if (ruta === PREFIJO) {
    return '/'
  }

  return ruta.startsWith(`${PREFIJO}/`) ? ruta.slice(PREFIJO.length) : ruta
}

/** Métodos que Fastify sabe manejar; cualquier otro ni se intenta. */
const METODOS: ReadonlySet<string> = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
])

/**
 * Comprueba que el método sea de los que `inject` sabe pasar.
 *
 * Sirve además para afinar el tipo: `request.method` es un `string` suelto y
 * `inject` solo admite su lista cerrada de métodos.
 */
function esMetodo(metodo: string): metodo is NonNullable<InjectOptions['method']> {
  return METODOS.has(metodo)
}

/**
 * Cabeceras que ya gestiona el runtime.
 *
 * `content-length` puede no coincidir con el cuerpo que devuelve `Response`
 * (Fastify calcula el suyo con el stream de `inject`), y las de transporte no
 * tienen sentido detrás de un proxy.
 */
const NO_COPIAR = new Set(['content-length', 'transfer-encoding', 'connection'])

/**
 * Atiende una petición de Vercel y devuelve la respuesta de Fastify.
 *
 * @param request La petición tal como la da el runtime de Vercel.
 * @param built App ya construida; solo para los tests, que la montan con su
 *   entorno y su base en memoria.
 */
export async function atender(request: Request, built?: BuiltApp): Promise<Response> {
  let app: BuiltApp

  try {
    app = built ?? (await appConstruida())
  } catch (error) {
    // Sin esto el usuario vería el 500 genérico de Vercel y nadie sabría que
    // el problema es de arranque (entorno o base de datos), no de una ruta.
    process.stderr.write(`[vercel] no se pudo montar la app: ${describir(error)}\n`)

    return json({ error: 'El servidor no está disponible' }, 500)
  }

  if (!esMetodo(request.method)) {
    return new Response(null, { status: 405, headers: { Allow: [...METODOS].join(', ') } })
  }

  const url = new URL(request.url)
  const conCuerpo = request.method !== 'GET' && request.method !== 'HEAD'
  const payload = conCuerpo ? Buffer.from(await request.arrayBuffer()) : undefined

  const opciones: InjectOptions = {
    method: request.method,
    url: rutaSinPrefijo(url) + url.search,
    headers: Object.fromEntries(request.headers),
    ...(payload === undefined ? {} : { payload }),
  }

  const respuesta: LightMyRequestResponse = await app.app.inject(opciones)

  return webResponse(respuesta)
}

/** Lo que devuelve `inject`, con lo mínimo que hace falta para copiarlo. */
type InjectedResponse = LightMyRequestResponse

/**
 * Pasa una respuesta de Fastify al formato `Response` de la web.
 *
 * `set-cookie` puede repetirse (la sesión y el estado del OAuth van en
 * cookies distintas), y `Headers` admite repetir con `append`. Si se usara
 * `set`, la segunda cookie borraría la primera y el login no tendría sesión.
 */
function webResponse(respuesta: InjectedResponse): Response {
  const cabeceras = new Headers()

  for (const [nombre, valor] of Object.entries(respuesta.headers)) {
    if (valor === undefined || NO_COPIAR.has(nombre)) {
      continue
    }

    if (Array.isArray(valor)) {
      for (const item of valor) {
        cabeceras.append(nombre, item)
      }
    } else {
      // `Headers` solo admite texto y `content-length` puede ser número.
      cabeceras.set(nombre, String(valor))
    }
  }

  const sinCuerpo = respuesta.statusCode === 204 || respuesta.statusCode === 304

  return new Response(sinCuerpo ? null : respuesta.rawPayload, {
    status: respuesta.statusCode,
    headers: cabeceras,
  })
}

/** Respuesta JSON, para los errores que ocurren antes de llegar a Fastify. */
function json(cuerpo: unknown, status: number): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/** Mensaje de error legible, sea cual sea lo que se haya tirado. */
function describir(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
