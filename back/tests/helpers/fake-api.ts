/**
 * Utilidades compartidas por los tests del cliente.
 *
 * Aquí vive el `fetch` falso: una forma de decir "la API devuelve esto" sin
 * tocar la red. Todos los tests de `src/api` lo usan.
 */

import type { RateLimiter } from '../../src/api/rate-limiter.js'
import { RateLimiter as RealRateLimiter } from '../../src/api/rate-limiter.js'
import { TokenManager } from '../../src/api/token-manager.js'

/**
 * Tipos de `fetch` tomados de la propia función.
 *
 * Escribir `RequestInfo` a mano no compila: con el `lib` de este proyecto
 * ese nombre no existe y TypeScript lo degrada a `any`, que es justo lo que
 * luego nois传出 los tipos.
 */
type FetchInput = Parameters<typeof fetch>[0]
type FetchInit = Parameters<typeof fetch>[1]

/** Petición que espera el `fetch` falso. */
export type RecordedCall = {
  url: string
  init: FetchInit
}

/** Respuesta que devuelve el `fetch` falso. */
export type FakeResponse = {
  status?: number
  body?: unknown
  headers?: Record<string, string>
  /** Texto crudo, para probar errores con HTML o cuerpo vacío. */
  text?: string
  /** Error de red o timeout, en vez de una respuesta. */
  throws?: Error
  /** Segundos que tarda, para probar el timeout. */
  delayMs?: number
}

/** `fetch` falso con registro de llamadas. */
export type FakeFetch = {
  fetchImpl: typeof fetch
  calls: RecordedCall[]
  /** URLs pedidas, en orden. */
  urls: () => string[]
  /** Cabeceras de la petición n-ésima. */
  headersOf: (index: number) => Record<string, string>
  /**
   * Cuerpo de la petición n-ésima, si se envió como texto.
   *
   * `BodyInit` es una unión de diecisiete tipos. Envolver aquí el narrowing
   * evita repartir casts por todos los tests.
   */
  bodyOf: (index: number) => string | undefined
}

function buildResponse(spec: FakeResponse): Response {
  const status = spec.status ?? 200
  const body = spec.text ?? (spec.body === undefined ? '' : JSON.stringify(spec.body))

  return new Response(status === 204 ? null : body, {
    status,
    headers: { 'content-type': 'application/json', ...spec.headers },
  })
}

/**
 * Crea un `fetch` falso.
 *
 * @param queue Respuestas por orden. Se recyclean: si se acaba la lista, la
 *              última se repite indefinidamente. Así un test de reintentos
 *              puede declarar "429, 429, 200" y ya está.
 */
export function createFakeFetch(queue: readonly FakeResponse[]): FakeFetch {
  const calls: RecordedCall[] = []
  let index = 0

  const fetchImpl = (async (input: FetchInput, init?: FetchInit) => {
    // `fetch` admite string, URL o Request. Los tests siempre pasan un string
    // o un URL, y extraer la URL sin convertir a texto a ciegas evita que un
    // Request acabe como "[object Request]".
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push({ url, init })

    const spec = queue[Math.min(index, queue.length - 1)] ?? {}
    index += 1

    if (spec.throws !== undefined) {
      throw spec.throws
    }

    if (spec.delayMs !== undefined) {
      await new Promise((resolve) => {
        setTimeout(resolve, spec.delayMs)
      })
    }

    return buildResponse(spec)
  }) as typeof fetch

  return {
    fetchImpl,
    calls,
    urls: () => calls.map((call) => call.url),
    headersOf: (position: number) => {
      const call = calls[position]
      const raw = call?.init?.headers
      if (raw === undefined) {
        return {}
      }
      return Object.fromEntries(Object.entries(raw as Record<string, string>))
    },
    bodyOf: (position: number) => {
      const body = calls[position]?.init?.body
      return typeof body === 'string' ? body : undefined
    },
  }
}

/** Reloj manual, para simular el paso del tiempo sin esperar. */
export function createFakeClock(start = 1_700_000_000_000) {
  let current = start
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms
    },
  }
}

/**
 * Limitador que no espera de verdad.
 *
 * Los límites se prueban con el reloj manual; aquí solo se neutraliza el
 * `sleep` para que el test no tarde 550 ms por llamada.
 */
export function instantRateLimiter(
  overrides: { maxPerMinute?: number; minDelayMs?: number } = {},
): RateLimiter {
  return new RealRateLimiter({
    minDelayMs: overrides.minDelayMs ?? 0,
    maxPerMinute: overrides.maxPerMinute ?? 10_000,
    sleep: async () => undefined,
  })
}

/** `sleep` que no espera y anota cuánto se le pidió dormir. */
export function createFakeSleep() {
  const waits: number[] = []
  return {
    waits,
    sleep: async (ms: number) => {
      waits.push(ms)
    },
  }
}

/** Gestor de token preconfigurado, sin llamadas de red. */
export function fakeTokenManager(accessToken = 'token-de-app'): TokenManager {
  return new TokenManager({
    tokenUrl: 'http://api.test/oauth/token',
    uid: 'uid',
    secret: 'secret',
    userAgent: 'test/1.0',
    fetchImpl: createFakeFetch([{ body: { access_token: accessToken, expires_in: 3600 } }])
      .fetchImpl,
  })
}