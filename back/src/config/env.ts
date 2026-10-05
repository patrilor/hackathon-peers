/**
 * Configuración del backend.
 *
 * Todas las variables de entorno se leen y validan **una sola vez**, al arrancar.
 * Si falta algo o está mal escrito, el proceso muere aquí con un mensaje claro
 * en vez de fallar más tarde con un `undefined` en la mitad de una petición.
 *
 * Nota de seguridad: el Secret de la app OAuth solo existe en este módulo y en
 * el cliente de la API. Nunca se registra en logs ni se devuelve en respuestas.
 */

import { z } from 'zod'

/**
 * Variables de entorno del backend de Sanatorio 42.
 *
 * Usa el prefijo `BACK_` para no colisionar con las variables `VITE_*` del front,
 * que leen un espacio de nombres distinto.
 */
const envSchema = z.object({
  // --- API de 42 ---------------------------------------------------------
  /** Client ID (UID) de la aplicación OAuth. */
  FORTY_TWO_UID: z.string().min(1, 'FORTY_TWO_UID no puede estar vacía'),
  /** Client Secret de la aplicación OAuth. Es una credencial real: nunca al log. */
  FORTY_TWO_SECRET: z.string().min(1, 'FORTY_TWO_SECRET no puede estar vacía'),

  /**
   * Raíz de la API de 42.
   *
   * Se declara aquí, y no fija en el código, por dos razones: poder apuntar a
   * un servidor simulado en los tests de integración, y no tener que recompilar
   * si algún día la 42 mueve la API de sitio.
   */
  FORTY_TWO_API_BASE: z
    .url('FORTY_TWO_API_BASE debe ser una URL válida')
    .default('https://api.intra.42.fr'),
  /** Dónde se pide el token. Normalmente `${FORTY_TWO_API_BASE}/oauth/token`. */
  FORTY_TWO_TOKEN_URL: z
    .url('FORTY_TWO_TOKEN_URL debe ser una URL válida')
    .default('https://api.intra.42.fr/oauth/token'),
  /**
   * `User-Agent` obligatorio.
   *
   * La API de 42 responde `403 Forbidden` a las peticiones sin `User-Agent`, y
   * el cuerpo viene vacío, así que el error es muy difícil de diagnosticar si
   * no se sabe esto. La 42 pide un identificador propio en sus docs.
   */
  FORTY_TWO_USER_AGENT: z
    .string()
    .min(1, 'FORTY_TWO_USER_AGENT es obligatoria')
    .default('sanatorio-42-backend/1.0 (+https://github.com/patrilor/hackathon-peers)'),

  // --- Servidor -----------------------------------------------------------
  /** Puerto donde escucha el backend. */
  PORT: z.coerce.number().int().positive().default(3000),
  /** Interfaz de escucha. `0.0.0.0` para que responda en Codespaces y contenedores. */
  HOST: z.string().default('0.0.0.0'),

  // --- Frontend -----------------------------------------------------------
  /**
   * Origen(es) del frontend a los que se permite hacer CORS con credenciales.
   *
   * OJO: `Access-Control-Allow-Credentials` es incompatible con el comodín `*`.
   * Si se deja vacío o mal puesto, el login parecerá funcionar pero `/auth/me`
   * devolverá 401 siempre, porque el navegador no manda la cookie de sesión.
   */
  FRONTEND_ORIGINS: z.string().min(1, 'FRONTEND_ORIGINS es obligatoria'),

  // --- OAuth --------------------------------------------------------------
  /**
   * Scopes que se piden en la URL de autorización, separados por espacios.
   *
   * El nombre exacto del scope de identidad **solo lo confirma el panel de la
   * aplicación**: `/oauth/authorize` no lo valida hasta que el usuario ya se ha
   * autenticado, así que un nombre mal escrito no falla aquí, falla después en el
   * login. Por eso va en el entorno y no hardcodeado.
   *
   * `public` es el default de la API. `profile` es el scope de datos de usuario
   * que aparece en el panel de la app 78735 ("manage user data"); sin él
   * `/v2/me` responde `404 {}`.
   */
  FORTY_TWO_SCOPES: z.string().default('public profile'),
  /**
   * Callback de OAuth. Debe estar registrada **carácter a carácter** en el panel
   * de la app de 42, o 42 no devolverá nunca el código.
   */
  FORTY_TWO_REDIRECT_URI: z.url('FORTY_TWO_REDIRECT_URI debe ser una URL válida'),
  /**
   * Clave para firmar las cookies de sesión. Sin ella, cualquier persona podría
   * fabricar su propia cookie y hacerse pasar por otra.
   */
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET debe tener al menos 16 caracteres'),
  /** A dónde vuelve el usuario tras el login. Normalmente el front. */
  FRONTEND_URL: z.url('FRONTEND_URL debe ser una URL válida'),

  // --- Base de datos ------------------------------------------------------
  /** Ruta del fichero SQLite. `:memory:` para tests. */
  DATABASE_PATH: z.string().default('data/sanatorio.db'),

  // --- Campus -------------------------------------------------------------
  /** Id del cursus. Common Core = 21. */
  CURSUS_ID: z.coerce.number().int().positive().default(21),

  // --- Sincronización -----------------------------------------------------
  /**
   * Segundos entre peticiones a la API de 42.
   *
   * El límite oficial es de 2 peticiones por segundo. 0.55 s de margen da
   * ~1.8 req/s, suficiente para no comerse un 429.
   */
  API_REQUEST_DELAY_SECONDS: z.coerce.number().positive().default(0.55),
  /** Timeout de las peticiones normales. */
  API_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  /** Peticiones por página a la API. El máximo de 42 es 100. */
  PAGE_SIZE: z.coerce.number().int().positive().max(100).default(100),
  /**
   * Límite de peticiones por minuto de **nuestro propio** sincronizador.
   *
   * Con 550 ms entre llamadas se llega a unas 109/min, así que 100 es el tope
   * que manda. Este límite solo evita ráfagas: para la cuota hay que mirar
   * `SYNC_REQUESTS_PER_HOUR`, porque 100/min son 6000/h.
   */
  SYNC_REQUESTS_PER_MINUTE: z.coerce.number().int().positive().max(600).default(100),
  /**
   * Límite de peticiones por hora. Es el tope real de la API de 42: pasarse
   * devuelve `429 Spam Rate Limit Exceeded` y, si se insiste, cierran la app.
   */
  SYNC_REQUESTS_PER_HOUR: z.coerce.number().int().positive().max(1200).default(1200),
})

/** Configuración normalizada: el entorno validado más lo derivado de él. */
export type Env = z.infer<typeof envSchema> & {
  /** Orígenes del front permitidos en CORS, sin barra final. */
  readonly allowedOrigins: readonly string[]
  /** Raíz de la API v2 de 42, con barra final. */
  readonly apiV2Base: string
  /** Origen del callback de OAuth, para poder verificar que no es de Vercel. */
  readonly oauthRedirectOrigin: string
  /** Scopes de OAuth ya troceados, sin entradas vacías. */
  readonly oauthScopes: readonly string[]
}

/**
 * Convierte la lista de orígenes del front en un array limpio.
 * Acepta coma o espacios como separador y quita la barra final.
 */
function parseOrigins(raw: string): string[] {
  return raw
    .split(/[,\s]+/)
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => origin.replace(/\/$/, ''))
}

/**
 * Trocea la lista de scopes de OAuth.
 *
 * Acepta coma o espacios, como los orígenes. Se quitan las entradas vacías
 * porque un scope en blanco sí se cuela en la URL de autorización: llega un
 * `scope` con espacios de más y 42 responde `invalid_scope` sin decir cuál sobra.
 */
function parseScopes(raw: string): string[] {
  return raw
    .split(/[,\s]+/)
    .map((scope) => scope.trim())
    .filter(Boolean)
}

/**
 * Lee el entorno, lo valida y devuelve un objeto congelado y normalizado.
 *
 * @param source Entorno de entrada. Por defecto `process.env`; los tests pasan el suyo.
 * @throws {z.ZodError} Si falta alguna variable obligatoria o es inválida.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.parse(source)

  const origins = parseOrigins(parsed.FRONTEND_ORIGINS)
  if (origins.length === 0) {
    throw new Error('FRONTEND_ORIGINS no contiene ningún origen válido.')
  }

  const apiBase = parsed.FORTY_TWO_API_BASE.replace(/\/$/, '')

  return Object.freeze({
    ...parsed,
    allowedOrigins: Object.freeze(origins),
    apiV2Base: `${apiBase}/v2`,
    oauthRedirectOrigin: new URL(parsed.FORTY_TWO_REDIRECT_URI).origin,
    oauthScopes: Object.freeze(parseScopes(parsed.FORTY_TWO_SCOPES)),
  })
}

/** Variables que existen y documenta `.env.example`. No se deben cambiar. */
export const REQUIRED_ENV_VARS = [
  'FORTY_TWO_UID',
  'FORTY_TWO_SECRET',
  'FRONTEND_ORIGINS',
  'FORTY_TWO_REDIRECT_URI',
  'SESSION_SECRET',
  'FRONTEND_URL',
] as const
