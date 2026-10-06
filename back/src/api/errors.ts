/**
 * Errores de la API de 42.
 *
 * Un solo tipo de error para toda la API, con lo justo para poder decidir qué
 * hacer: si se reintenta, si hay que renovar el token, o si es un fallo
 * nuestro y hay que soltarlo hacia arriba.
 */

/** Códigos de error que la API de 42 devuelve en el cuerpo. */
export type ApiErrorCode =
  | 'rate_limited'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'bad_request'
  | 'server_error'
  | 'network_error'
  | 'timeout'

/** Campos del error de 42, con lo que suele venir. */
export type ApiErrorBody = {
  error?: string
  message?: string
  status?: number
}

/** Detalle de por qué se reintentó o no, para logs y tests. */
export type ApiErrorOptions = {
  /**
   * Ruta llamada, para localizar el fallo en el log.
   *
   * Opcional: se deduce del status cuando no se indica.
   */
  endpoint?: string | undefined
  /**
   * Código normalizado.
   *
   * Opcional y derivado del status a propósito: obligar a repetir en cada
   * `new` lo que `codeForStatus` ya sabe es una fuente de errores de copia.
   */
  code?: ApiErrorCode | undefined
  /** Cuerpo de la respuesta, si lo hubo y se pudo leer como JSON. */
  body?: ApiErrorBody | undefined
  /** Segundos que la API pidió esperar, vía `Retry-After`. */
  retryAfterSeconds?: number | undefined
  /**
   * Cabeceras de la respuesta, si las hubo.
   *
   * Se guardan porque son la única forma de conocer la cuota que queda: la API
   * de 42 manda `x-secondly-ratelimit-remaining` y `x-hourly-ratelimit-remaining`
   * en **cada** respuesta, y un `429` es cuando más las necesitas.
   */
  headers?: Headers | undefined
  /** Error original, cuando el fallo fue de red o de timeout. */
  cause?: unknown
  /**
   * Fuerza la decisión de reintentar.
   *
   * Hace falta porque los fallos sin respuesta HTTP se construyen con
   * `status: 0`, y el status por sí solo no los distingue de un error que de
   * verdad no tiene sentido reintentar. Un `ECONNRESET` o un timeout sí se
   * reintentan: el servidor puede estar reiniciando o simplemente tardando.
   */
  retryable?: boolean | undefined
}

/**
 * Error normalizado de la API de 42.
 *
 * Se distingue del `Error` normal por `retryable`: un 429 o un 503 se reintentan,
 * un 404 o un 400 no. Reintentar un 404 solo gasta cuota de la API.
 */
export class ApiError extends Error {
  readonly endpoint: string
  readonly code: ApiErrorCode
  readonly status: number
  readonly body: ApiErrorBody | undefined
  readonly retryAfterSeconds: number | undefined
  readonly headers: Headers | undefined
  readonly retryable: boolean

  // El objeto de detalles es opcional: para un error de estado no hay nada más
  // que contar, y obligar a pasar un `{}` vacío en todas partes solo añade ruido.
  constructor(message: string, status: number, options: ApiErrorOptions = {}) {
    super(message, { cause: options.cause })
    this.name = 'ApiError'
    this.endpoint = options.endpoint ?? ''
    this.code = options.code ?? codeForStatus(status)
    this.status = status
    this.body = options.body
    this.retryAfterSeconds = options.retryAfterSeconds
    this.headers = options.headers
    this.retryable = options.retryable ?? isRetryableStatus(status)
  }
}

/**
 * Decide si un status HTTP merece la pena reintentar.
 *
 * 429 es el caso importante: la API de 42 aplica un límite de 2 req/s y
 * 1200 req/h, y responde 429 "Spam Rate Limit Exceeded" al pasarse.
 * Los 5xx son fallos transitorios. Un 4xx no lo es: reintentar no cambia nada
 * y cada intento vuelve a gastar cuota.
 */
export function isRetryableStatus(status: number): boolean {
  if (status === 408 || status === 429) {
    return true
  }
  return status >= 500 && status <= 599
}

/** Traduce un status HTTP al código normalizado. */
export function codeForStatus(status: number): ApiErrorCode {
  if (status === 408) {
    return 'timeout'
  }
  if (status === 429) {
    return 'rate_limited'
  }
  if (status === 401) {
    return 'unauthorized'
  }
  if (status === 403) {
    return 'forbidden'
  }
  if (status === 404) {
    return 'not_found'
  }
  if (status >= 400 && status < 500) {
    return 'bad_request'
  }
  if (status >= 500) {
    return 'server_error'
  }
  return 'server_error'
}

/**
 * Construye un `ApiError` a partir de una respuesta que no fue `ok`.
 *
 * @param status Status HTTP de la respuesta.
 * @param endpoint Ruta llamada, para poder localizarla en los logs.
 * @param raw Cuerpo de la respuesta como texto. Puede venir HTML vacío o JSON.
 * @param headers Cabeceras de la respuesta, para leer `Retry-After`.
 */
export function apiErrorFromResponse(
  status: number,
  endpoint: string,
  raw: string,
  headers: Headers,
): ApiError {
  const body = safeParseJson(raw)
  const retryAfter = parseRetryAfter(headers.get('retry-after'))

  // El mensaje de 42 suele venir en `message`; algunos endpoints solo mandan `error`.
  const message = body?.message ?? body?.error ?? `La API de 42 respondió ${status} a ${endpoint}`

  return new ApiError(message, status, {
    endpoint,
    code: codeForStatus(status),
    body,
    retryAfterSeconds: retryAfter,
    headers,
  })
}

/** Construye el error de un fallo de red, sin respuesta HTTP. */
export function apiErrorFromNetwork(endpoint: string, cause: unknown): ApiError {
  const isTimeout = cause instanceof Error && cause.name === 'TimeoutError'

  return new ApiError(
    isTimeout ? `Timeout esperando a la API de 42 en ${endpoint}` : `Fallo de red en ${endpoint}`,
    // 0 porque no hubo respuesta HTTP. Aun así se reintenta: tanto un timeout
    // como un `ECONNRESET` son fallos transitorios, y el status no lo refleja.
    0,
    { endpoint, code: isTimeout ? 'timeout' : 'network_error', cause, retryable: true },
  )
}

/**
 * ¿El error es de credenciales?
 *
 * Una respuesta 401 o 403 con el token de la aplicación significa que el UID o
 * el secreto ya no valen. Reintentar solo gastaría cuota de la API, así que
 * quien lo reciba debe parar y avisar.
 */
export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'unauthorized' || error.code === 'forbidden')
}

/**
 * Extrae la ruta de una URL para los logs y los errores.
 *
 * Se quita la query: `?page=2&per_page=100` solo añade ruido al mensaje, y la
 * ruta por sí sola ya localiza la llamada. Se deja el prefijo `/v2`, que es
 * como aparecen los endpoints en la documentación de la 42.
 */
export function endpointFromUrl(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}

/**
 * Lee `Retry-After`, que puede venir en segundos o como fecha HTTP.
 *
 * La 42 manda segundos, pero el estándar también permite una fecha y no
 * merece la pena distinguir: si no se puede entender, se ignora y se usa
 * el backoff normal.
 */
export function parseRetryAfter(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined || value.trim() === '') {
    return undefined
  }

  const seconds = Number(value)
  if (!Number.isNaN(seconds) && seconds >= 0) {
    return seconds
  }

  const date = Date.parse(value)
  if (Number.isNaN(date)) {
    return undefined
  }
  return Math.max(0, Math.ceil((date - Date.now()) / 1000))
}

/** Intenta leer JSON sin lanzar si el cuerpo no es JSON válido. */
export function safeParseJson(raw: string): ApiErrorBody | undefined {
  if (raw.trim() === '') {
    return undefined
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) {
      return undefined
    }
    return parsed
  } catch {
    // La 42 devuelve HTML o texto plano en algunos errores. No es motivo
    // para perder el error original: nos quedamos sin cuerpo y seguimos.
    return undefined
  }
}
