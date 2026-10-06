/**
 * Ritmo de las peticiones a la API de 42.
 *
 * La API limita a **2 peticiones por segundo** y **1 200 por hora**, y lo dice:
 * cada respuesta trae `x-secondly-ratelimit-remaining`,
 * `x-secondly-ratelimit-limit`, `x-hourly-ratelimit-remaining` y
 * `x-hourly-ratelimit-limit`.
 *
 * La versión anterior de este back no leía esas cabeceras y dormía 550 ms entre
 * peticiones a ciegas, con un limitador de 218 líneas para contar por minuto y
 * por hora. Como las cabeceras dicen exactamente cuánto queda, no hace falta
 * contar nada: se pregunta a la API y se espera lo que ella dice.
 *
 * Lo medido contra la API real, en una respuesta de `projects_users`:
 *
 * ```
 * x-secondly-ratelimit-limit: 2
 * x-secondly-ratelimit-remaining: 2
 * x-hourly-ratelimit-limit: 1200
 * x-hourly-ratelimit-remaining: 1197
 * ```
 *
 * Ojo con la interpretación: `remaining` es lo que queda **después** de la
 * petición que acabamos de hacer. Si sale `0`, la siguiente tiene que esperar a
 * que pase el segundo, o la API responde `429`.
 */

/** Cabeceras que manda la API de 42 con su cuota. */
const SECONDLY_REMAINING = 'x-secondly-ratelimit-remaining'
const HOURLY_REMAINING = 'x-hourly-ratelimit-remaining'

/**
 * Por debajo de este número de peticiones por hora restantes, se estira el
 * ritmo.
 *
 * Estirar es mejor que parar: si no queda nada, avisar por stderr y esperar es
 * más honesto que un error, y a 1 200 por hora la única forma de llegar aquí es
 * que algo esté fuera de lo normal.
 */
const HOURLY_CAUTION = 30

/** Cuánto se espera de más cuando la cuota por hora anda baja. */
const HOURLY_CAUTION_DELAY_MS = 1_000

export type ThrottleOptions = {
  /** Separación mínima entre peticiones, en ms. Evita ráfagas en el mismo tick. */
  minIntervalMs: number
  /** `sleep` inyectable, para que los tests no esperen de verdad. */
  sleep?: (ms: number) => Promise<void>
  /** Reloj inyectable, para tests. */
  now?: () => number
}

export type Throttle = {
  /** Se llama antes de cada petición. Espera lo que haga falta. */
  before: () => Promise<void>
  /** Se llama con las cabeceras de cada respuesta. */
  observe: (headers: Headers) => void
  /** Último valor leído de la cuota por hora. `undefined` si aún no se ha preguntado. */
  hourlyRemaining: () => number | undefined
  /** Qué se está esperando ahora mismo, en ms. Para logs y tests. */
  pendingDelayMs: () => number
}

export function createThrottle(options: ThrottleOptions): Throttle {
  const sleep = options.sleep ?? defaultSleep
  const now = options.now ?? Date.now

  let lastAt = 0
  let forcedDelayMs = 0
  let hourly: number | undefined

  /**
   * Además de esperar, va encadenando las peticiones.
   *
   * Dos peticiones que salen a la vez del mismo bucle se llevarían la misma
   * ventana de un segundo y la API respondería `429` a la segunda. La promesa de
   * la anterior es el suelo de la siguiente, así que nunca salen juntas.
   */
  let chain: Promise<void> = Promise.resolve()

  function delayFor(headers: Headers): number {
    // La cuota por hora se lee siempre, incluso si el resto no cuadra: sirve para
    // diagnóstico, y perderla en silencio haría imposible saber si la API está
    // a punto de cortar.
    const hourlyRemaining = readInt(headers, HOURLY_REMAINING)
    if (hourlyRemaining !== undefined) {
      hourly = hourlyRemaining
    }

    const remaining = readInt(headers, SECONDLY_REMAINING)

    if (remaining === undefined) {
      // La API no lo mandó (o es un mock de los tests): nos quedamos con el
      // suelo, que es lo que se hacía antes de saber nada.
      return 0
    }

    // `remaining` es lo que queda tras esta petición. Con `2` por segundo, si
    // no queda nada hay que esperar a que el contador se reinicie.
    if (remaining <= 0) {
      return 1_000
    }

    if (hourlyRemaining !== undefined && hourlyRemaining < HOURLY_CAUTION) {
      return HOURLY_CAUTION_DELAY_MS
    }

    return 0
  }

  return {
    before: () => {
      const run = async (): Promise<void> => {
        const elapsed = now() - lastAt
        const wait = Math.max(forcedDelayMs, options.minIntervalMs - elapsed)

        if (wait > 0) {
          await sleep(wait)
        }

        lastAt = now()
        forcedDelayMs = 0
      }

      // Encadenar en vez de dejar que cada llamada calcule su `wait` por su
      // cuenta es lo que evita que dos coerran al mismo tick.
      chain = chain.then(run, run)

      return chain
    },

    observe: (headers: Headers) => {
      forcedDelayMs = delayFor(headers)
    },

    hourlyRemaining: () => hourly,

    pendingDelayMs: () => forcedDelayMs,
  }
}

/** Lee una cabecera como entero. `undefined` si no está o no es un número. */
function readInt(headers: Headers, name: string): number | undefined {
  const raw = headers.get(name)

  if (raw === null || raw.trim() === '') {
    return undefined
  }

  const parsed = Number(raw)

  return Number.isNaN(parsed) ? undefined : parsed
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}