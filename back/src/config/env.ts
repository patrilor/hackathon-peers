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
  /** Puerto donde escucha el backend. Solo se usa en local. */
  PORT: z.coerce.number().int().positive().default(3000),
  /** Interfaz de escucha. `0.0.0.0` para Codespaces y contenedores. */
  HOST: z.string().default('0.0.0.0'),

  // --- Frontend -----------------------------------------------------------
  /**
   * Origen(es) del frontend a los que se permite CORS con credenciales.
   *
   * En producción el front y el back se sirven desde el **mismo dominio**
   * (`sanatorio-42.vercel.app`), así que no hay CORS que hablar y esta variable
   * no hace falta. Solo es obligatoria para desarrollo, donde Vite sirve el
   * front en `localhost:5173` y el back en `localhost:3000`.
   *
   * Si se deja vacía, se usa `FRONTEND_URL` como único origen permitido.
   */
  FRONTEND_ORIGINS: z.string().default(''),
  /** A dónde vuelve el usuario tras el login. Normalmente el front. */
  FRONTEND_URL: z.url('FRONTEND_URL debe ser una URL válida'),

  // --- OAuth --------------------------------------------------------------
  /**
   * Scopes que se piden en la URL de autorización, separados por espacios.
   *
   * El nombre exacto del scope de identidad **solo lo confirma el panel de la
   * aplicación**: `/oauth/authorize` no lo valida hasta que el usuario ya se ha
   * autenticado, así que un nombre mal escrito no falla aquí, falla después en el
   * login. Por eso va en el entorno y no hardcodeado.
   *
   * `public` es el default de la API y basta para leer proyectos y
   * participantes. `profile` es el scope de datos de usuario que aparece en el
   * panel de la app ("manage user data"); sin él, `/v2/me` responde `404 {}` y
   * el login no puede saber de quién es la sesión.
   */
  FORTY_TWO_SCOPES: z.string().default('public profile'),
  /**
   * Callback de OAuth. Debe estar registrada **carácter a carácter** en el panel
   * de la app de 42, o 42 no devolverá nunca el código.
   *
   * En producción: `https://sanatorio-42.vercel.app/api/auth/callback`.
   */
  FORTY_TWO_REDIRECT_URI: z.url('FORTY_TWO_REDIRECT_URI debe ser una URL válida'),
  /**
   * Clave para firmar las cookies. Sin ella, cualquier persona podría fabricar su
   * propia cookie y hacerse pasar por otra.
   *
   * Como la sesión va dentro de la cookie firmada (no hay tabla de sesiones),
   * esta clave es lo único que impide suplantar a alguien.
   */
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET debe tener al menos 16 caracteres'),

  // --- Base de datos ------------------------------------------------------
  /**
   * Conexión a la base de datos.
   *
   * Acepta los dos formatos de libsql/Turso:
   *
   * - `libsql://tu-db.turso.io` + `TURSO_AUTH_TOKEN`, en producción (Vercel).
   * - `file:data/sanatorio.db`, en local y en los tests. Sin token.
   *
   * Se usa `@libsql/client` y no `better-sqlite3` porque es HTTP puro: no
   * necesita binario nativo, que es lo que hace que `better-sqlite3` no sea una
   * opción fiable en Vercel. El coste es que las consultas son `async`.
   */
  DATABASE_URL: z.string().min(1, 'DATABASE_URL no puede estar vacía').default('file:data/sanatorio.db'),
  /**
   * Token de Turso. Solo hace falta con `libsql://`; se ignora con `file:`.
   *
   * Es una credencial real: nunca al log, nunca en git.
   */
  TURSO_AUTH_TOKEN: z.string().default(''),

  // --- Caché de lectura contra la API de 42 --------------------------------
  /**
   * Peticiones por página a la API. El máximo de 42 es 100.
   *
   * Con 100, el proyecto 2689 ("Call Me Maybe", 2 047 participantes) son 21
   * páginas. Subirlo no ayuda: 100 es el tope del servidor.
   */
  PAGE_SIZE: z.coerce.number().int().positive().max(100).default(100),

  /**
   * Páginas nuevas de peers que se descargan como mucho en una petición.
   *
   * El límite duro de la API de 42 son 2 peticiones por segundo. Con 21 páginas
   * por proyecto grande, descargarlas enteras son ~11 s: más que el límite de
   * duración de una función en el plan gratuito de Vercel.
   *
   * Por eso la caché va página a página y cada petición solo gasta un
   * presupuesto. Con 5, un proyecto grande se completa en 4-5 visitas y una
   * función se mantiene por debajo de los 3 s.
   *
   * Si el plan de Vercel permite funciones más largas, sube este número a 21 y
   * la primera respuesta ya sale completa. No hay que tocar nada más.
   */
  PEERS_PAGE_BUDGET: z.coerce.number().int().positive().max(100).default(5),

  /**
   * Cuánto se considera fresco un proyecto.
   *
   * Las páginas de peers caducan todas a la vez: si han caducado, la siguiente
   * petición empieza a reescribirlas por el presupuesto.
   */
  PEERS_TTL_SECONDS: z.coerce.number().int().positive().default(900),

  /**
   * Cuánto se considera frescos los proyectos de una persona.
   *
   * `GET /v2/users/:login/projects_users` son una o dos peticiones, así que no
   * hay problema de coste; el TTL existe para que al recargar la web no se
   * vuelva a preguntar a 42 lo mismo que ya sabemos.
   */
  USER_PROJECTS_TTL_SECONDS: z.coerce.number().int().positive().default(1800),

  /**
   * Separación mínima entre peticiones a la API de 42, en milisegundos.
   *
   * La API manda `x-secondly-ratelimit-remaining` en cada respuesta, y el
   * throttling se guía por eso (ver `api/throttle.ts`): cuando queda poca
   * cuota por segundo espera más, y cuando sobra no espera. Este valor es solo
   * el suelo, para no machacar dos peticiones seguidas en el mismo tick.
   *
   * `0` quita el suelo y deja solo las cabeceras de la API, que es lo que
   * necesitan los tests y lo que puede servir en local.
   */
  MIN_REQUEST_INTERVAL_MS: z.coerce.number().int().min(0).default(250),

  /** Timeout de las peticiones a la API de 42. */
  API_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),

  /** Intentos antes de rendirse, sin contar el primero. */
  API_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
})

/** Configuración normalizada: el entorno validado más lo derivado de él. */
export type Env = z.infer<typeof envSchema> & {
  /** Orígenes del front permitidos en CORS, sin barra final. */
  readonly allowedOrigins: readonly string[]
  /** Raíz de la API v2 de 42, con barra final. */
  readonly apiV2Base: string
  /** Scopes de OAuth ya troceados, sin entradas vacías. */
  readonly oauthScopes: readonly string[]
  /** `true` si la base es un fichero local y no un servidor Turso. */
  readonly isLocalFile: boolean
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

  // Sin `FRONTEND_ORIGINS` explícitos se permite solo el front de `FRONTEND_URL`,
  // que es exactamente lo que hace falta en producción al servir ambos desde el
  // mismo dominio.
  const origins = parseOrigins(parsed.FRONTEND_ORIGINS)
  const allowedOrigins =
    origins.length > 0 ? origins : [new URL(parsed.FRONTEND_URL).origin.replace(/\/$/, '')]

  const apiBase = parsed.FORTY_TWO_API_BASE.replace(/\/$/, '')
  const isLocalFile = parsed.DATABASE_URL.startsWith('file:')

  if (!isLocalFile && parsed.TURSO_AUTH_TOKEN === '') {
    throw new Error(
      'DATABASE_URL apunta a un servidor Turso (`libsql://`) pero TURSO_AUTH_TOKEN está vacía. ' +
        'El token se descarga en el panel de Turso, en la pestaña "Keys".',
    )
  }

  return Object.freeze({
    ...parsed,
    allowedOrigins: Object.freeze(allowedOrigins),
    apiV2Base: `${apiBase}/v2`,
    oauthScopes: Object.freeze(parseScopes(parsed.FORTY_TWO_SCOPES)),
    isLocalFile,
  })
}

/**
 * Variables que sin falta no puede arrancar el backend.
 *
 * `FRONTEND_ORIGINS` ya no está: en producción el front y el back comparten
 * dominio, y en local se deduce de `FRONTEND_URL`.
 */
export const REQUIRED_ENV_VARS = [
  'FORTY_TWO_UID',
  'FORTY_TWO_SECRET',
  'FORTY_TWO_REDIRECT_URI',
  'SESSION_SECRET',
  'FRONTEND_URL',
] as const