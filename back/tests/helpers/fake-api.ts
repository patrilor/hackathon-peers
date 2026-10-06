/**
 * Utilidades compartidas por los tests del cliente.
 *
 * Aquí vive el `fetch` falso: una forma de decir "la API devuelve esto" sin
 * tocar la red. Todos los tests de `src/api` lo usan.
 *
 * Ya no hay ni `RateLimiter` ni `TokenManager`: en su lugar están el
 * `Throttle` (que se guía por las cabeceras de cuota) y el proveedor de token de
 * aplicación (`app-token.ts`). Los tests los sustituyen por versiones que no
 * esperan de verdad, con `instantThrottle` y `stubAppTokens`.
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
 * Cabeceras de cuota que devuelve la API real.
 *
 * Se añaden a todas las respuestas del `fetch` falso por defecto porque el
 * `Throttle` las lee en cada respuesta: sin ellas, cada petición parece la
 * primera y no hay forma de probar el ritmo.
 */
export const QUOTA_HEADERS: Record<string, string> = {
  'x-secondly-ratelimit-limit': '2',
  'x-secondly-ratelimit-remaining': '2',
  'x-hourly-ratelimit-limit': '1200',
  'x-hourly-ratelimit-remaining': '1197',
}

/**
 * Crea un `fetch` falso.
 *
 * @param queue Respuestas por orden. Se recyclean: si se acaba la lista, la
 *              última se repite indefinidamente. Así un test de reintentos
 *              puede declarar "429, 429, 200" y ya está.
 * @param defaults Cabeceras que se añaden a cada respuesta.
 */
export function createFakeFetch(
  queue: readonly FakeResponse[],
  defaults: Record<string, string> = {},
): FakeFetch {
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

    return buildResponse({ ...spec, headers: { ...defaults, ...spec.headers } })
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

/**
 * `Throttle` que no espera de verdad.
 *
 * El ritmo se prueba con el reloj manual en `throttle.test.ts`; aquí solo se
 * neutraliza la espera para que un test con tres peticiones no tarde medio
 * segundo. `observe` se sigue contando para que los tests puedan mirar la cuota
 * restante.
 */
export function instantThrottle(minIntervalMs = 0) {
  const waits: number[] = []
  let startedAt = 0
  let hourlyRemaining = 1200

  return {
    throttle: {
      before: async (): Promise<void> => {
        const wait = Math.max(0, minIntervalMs - (Date.now() - startedAt))
        waits.push(wait)
        startedAt = Date.now() + wait
      },
      observe: (headers: Headers): void => {
        const remaining = headers.get('x-hourly-ratelimit-remaining')

        if (remaining !== null) {
          hourlyRemaining = Number(remaining)
        }
      },
      hourlyRemaining: () => hourlyRemaining,
      pendingDelayMs: () => 0,
    },
    waits,
  }
}

/**
 * Proveedor de token de aplicación preconfigurado, sin llamadas de red.
 *
 * Devuelve siempre el mismo token, que es justo lo que se quiere en un test de
 * `src/api`: la diferencia con el proveedor real ya tiene su propio test, contra
 * el endpoint de token.
 */
export function stubAppTokens(accessToken = 'token-de-app') {
  let invalidations = 0

  return {
    provider: {
      getToken: async (): Promise<string> => accessToken,
      invalidate: (): void => {
        invalidations += 1
      },
    },
    /** Cuántas veces se ha pedido tirar el token a la basura. */
    invalidations: () => invalidations,
  }
}