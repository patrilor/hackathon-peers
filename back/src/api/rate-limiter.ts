/**
 * Limitador de peticiones.
 *
 * La API de 42 permite 2 peticiones por segundo y 1200 por hora. Pasarse no es
 * una multa: la respuesta es un `429 Spam Rate Limit Exceeded` y, si
 * insistes, te pueden cerrar la aplicación. Ya nos pasó al investigar
 * `/campus/:id/locations`.
 *
 * Tres límites que se complementan:
 * - **Delay mínimo** entre peticiones (550 ms ≈ 1.8 req/s), para no reventar el
 *   límite de bursting por segundo.
 * - **Tope por minuto**, que evita ráfagas.
 * - **Tope por hora**, que es el que de verdad protege la cuota. El tope por
 *   minuto solo no sirve: 100/min son 6000/hora, muy por encima de las 1200
 *   que aguanta la API.
 *
 * Todos son ventanas deslizantes: se cuentan las peticiones que salieron en los
 * últimos X ms, no las del minuto en curso. Con ventanas fijas, un cliente que
 * dispara en el borde del minuto se come dos cuotas seguidas.
 *
 * Además **serializa**: si llegan diez llamadas a la vez, se atienden una detrás
 * de otra. Sin esto, el delay mínimo no sirve de nada, porque todas medirían el
 * tiempo desde la misma referencia y saldrían disparadas a la vez.
 */

/** Ventana deslizante de peticiones. */
type Window = {
  /** Peticiones máximas dentro de la ventana. */
  max: number
  /** Longitud de la ventana, en milisegundos. */
  windowMs: number
  /** Instantes en los que salieron las peticiones que siguen dentro. */
  starts: number[]
}

/** Inyectables para poder testear sin esperar de verdad a 550 ms. */
export type RateLimiterOptions = {
  /** Milisegundos mínimos entre dos peticiones. */
  minDelayMs: number
  /** Peticiones máximas en una ventana de un minuto. */
  maxPerMinute: number
  /**
   * Peticiones máximas en una ventana de una hora.
   *
   * Es el límite que la API aplica de verdad. Sin él, el tope por minuto deja
   * pasar seis veces la cuota horaria.
   */
  maxPerHour?: number
  /** Duración de la ventana de un minuto, en milisegundos. */
  windowMs?: number
  /** Reloj, para simular el paso del tiempo. */
  now?: () => number
  /** Espera, inyectada para no depender del reloj real en los tests. */
  sleep?: (ms: number) => Promise<void>
}

/** Longitud de las ventanas por defecto. */
const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000

export class RateLimiter {
  readonly minDelayMs: number
  readonly maxPerMinute: number

  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly windows: Window[]

  /** Momento de la última petición que salió hacia la API. */
  private lastStartedAt = Number.NEGATIVE_INFINITY

  /**
   * Cadena de promesas que serializa las llamadas.
   *
   * Es la clave de que el limitador funcione: cada tarea espera a que la
   * anterior termine, y solo entonces se reserva su hueco.
   */
  private tail: Promise<void> = Promise.resolve()

  constructor(options: RateLimiterOptions) {
    this.minDelayMs = options.minDelayMs
    this.maxPerMinute = options.maxPerMinute
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? defaultSleep
    this.windows = [
      { max: options.maxPerMinute, windowMs: options.windowMs ?? MINUTE_MS, starts: [] },
    ]

    if (options.maxPerHour !== undefined) {
      this.windows.push({ max: options.maxPerHour, windowMs: HOUR_MS, starts: [] })
    }
  }

  /**
   * Peticiones que aún caben en la ventana de `windowMs`.
   *
   * Sirve para decidir si merece la pena lanzar una sincronización completa o
   * dejar que el reloj la desangre: con 50 peticiones pendientes y 0 huecos en
   * la hora, mejor responder con la caché y reintentar más tarde.
   */
  remainingIn(windowMs: number): number {
    this.pruneWindows()

    const window = this.windows.find((candidate) => candidate.windowMs === windowMs)

    return window === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(0, window.max - window.starts.length)
  }

  /**
   * Ejecuta `task` respetando los tres límites.
   *
   * @param task La petición a ejecutar. No se llama hasta que hay hueco.
   * @returns Lo que devuelva `task`, con sus errores intactos.
   */
  run<T>(task: () => Promise<T>): Promise<T> {
    // Encadenar sobre `tail` sea cual sea el resultado: un fallo no puede dejar la
    // cadena rota y bloquear las siguientes llamadas para siempre.
    const result = this.tail.then(
      () => this.execute(task),
      () => this.execute(task),
    )

    this.tail = result.then(
      () => undefined,
      () => undefined,
    )

    return result
  }

  /** Espera el hueco, marca la salida y ejecuta la tarea. */
  private async execute<T>(task: () => Promise<T>): Promise<T> {
    await this.waitForSlot()
    this.recordStart()
    return task()
  }

  /**
   * Espera hasta que se pueda disparar una petición sin pasarse.
   *
   * Puede tener que dar varias vueltas: una por cada ventana que esté llena, y
   * otra por el delay mínimo. Cada espera se recalcula porque al despertar el
   * tiempo ya ha cambiado.
   */
  private async waitForSlot(): Promise<void> {
    for (;;) {
      this.pruneWindows()

      const full = this.windows.find((window) => window.starts.length >= window.max)

      if (full !== undefined) {
        const oldest = full.starts[0]
        if (oldest !== undefined) {
          await this.sleep(Math.max(0, oldest + full.windowMs - this.now()))
        }
        continue
      }

      const sinceLast = this.now() - this.lastStartedAt
      if (sinceLast >= this.minDelayMs) {
        return
      }

      await this.sleep(this.minDelayMs - sinceLast)
    }
  }

  /** Anota que ya salió una petición, en todas las ventanas. */
  private recordStart(): void {
    const moment = this.now()
    this.lastStartedAt = moment

    for (const window of this.windows) {
      window.starts.push(moment)
    }
  }

  /** Descarta de cada ventana las salidas que ya se le han salido. */
  private pruneWindows(): void {
    const moment = this.now()

    for (const window of this.windows) {
      const limit = moment - window.windowMs
      window.starts = window.starts.filter((startedAt) => startedAt > limit)
    }
  }
}

/** Espera por defecto, sin dependencias. */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * Crea un limitador a partir de la configuración de la aplicación.
 *
 * Los tres topes vienen del entorno, para que CLI y servidor compartan
 * exactamente los mismos números: si el `sync-once` gastara distinto, la cuota
 * se consumiría en el peor momento.
 */
export function createRateLimiter(options: {
  delaySeconds: number
  requestsPerMinute: number
  requestsPerHour: number
}): RateLimiter {
  return new RateLimiter({
    minDelayMs: Math.round(options.delaySeconds * 1000),
    maxPerMinute: options.requestsPerMinute,
    maxPerHour: options.requestsPerHour,
  })
}

/** Longitud de la ventana horaria, para `remainingIn`. */
export const HOUR_WINDOW_MS = HOUR_MS
