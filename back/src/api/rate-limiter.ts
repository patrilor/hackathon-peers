/**
 * Limitador de peticiones.
 *
 * La API de 42 permite 2 peticiones por segundo y 1200 por hora. Pasarse no es
 * una multa: la respuesta es un `429 Spam Rate Limit Exceeded` y, si
 * insistes, te pueden cerrar la aplicación. Ya nos pasó al investigar
 * `/campus/:id/locations`.
 *
 * Dos límites que se complementan:
 * - **Delay mínimo** entre peticiones (550 ms ≈ 1.8 req/s), para no reventar el
 *   límite de bursting por segundo.
 * - **Tope por minuto**, que es el que protege de la cuota horaria. 100/min son
 *   6000/hora si no se respeta, así que hay que mirar el largo plazo: con 100/min
 *   el agregado es de 60/min. Ver `SYNC_REQUESTS_PER_MINUTE` en la configuración.
 *
 * Además **serializa**: si llegan diez llamadas a la vez, se atienden una detrás
 * de otra. Sin esto, el delay mínimo no sirve de nada, porque todas medirían el
 * tiempo desde la misma referencia y saldrían disparadas a la vez.
 */

/** Inyectables para poder testear sin esperar de verdad a 550 ms. */
export type RateLimiterOptions = {
  /** Milisegundos mínimos entre dos peticiones. */
  minDelayMs: number
  /** Peticiones máximas en una ventana de un minuto. */
  maxPerMinute: number
  /** Duración de la ventana, en milisegundos. */
  windowMs?: number
  /** Reloj, para simular el paso del tiempo. */
  now?: () => number
  /** Espera, inyectada para no depender del reloj real en los tests. */
  sleep?: (ms: number) => Promise<void>
}

/** Longitud de la ventana por minuto. */
const DEFAULT_WINDOW_MS = 60_000

export class RateLimiter {
  readonly minDelayMs: number
  readonly maxPerMinute: number

  private readonly windowMs: number
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>

  /** Momento de la última petición que salió hacia la API. */
  private lastStartedAt = Number.NEGATIVE_INFINITY

  /** Instantes de salida de las peticiones dentro de la ventana actual. */
  private windowStarts: number[] = []

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
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? defaultSleep
  }

  /**
   * Ejecuta `task` respetando los dos límites.
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
   * Puede tener que dar dos vueltas: una para cumplir el delay mínimo, y otra
   * por si al despertar la ventana de un minuto sigue llena.
   */
  private async waitForSlot(): Promise<void> {
    for (;;) {
      this.pruneWindow()

      if (this.windowStarts.length >= this.maxPerMinute) {
        const oldest = this.windowStarts[0]
        if (oldest !== undefined) {
          await this.sleep(oldest + this.windowMs - this.now())
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

  /** Anota que ya salió una petición. */
  private recordStart(): void {
    const moment = this.now()
    this.lastStartedAt = moment
    this.windowStarts.push(moment)
  }

  /** Descarta las salidas que ya se han salido de la ventana. */
  private pruneWindow(): void {
    const limit = this.now() - this.windowMs
    this.windowStarts = this.windowStarts.filter((startedAt) => startedAt > limit)
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
 * El delay mínimo viene de `API_REQUEST_DELAY_SECONDS` y el tope de
 * `SYNC_REQUESTS_PER_MINUTE`, que están en el entorno.
 */
export function createRateLimiter(options: {
  delaySeconds: number
  requestsPerMinute: number
}): RateLimiter {
  return new RateLimiter({
    minDelayMs: Math.round(options.delaySeconds * 1000),
    maxPerMinute: options.requestsPerMinute,
  })
}