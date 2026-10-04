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
  /** Id del campus en la API de 42. Madrid = 22. */
  CAMPUS_ID: z.coerce.number().int().positive().default(22),
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
  /**
   * Timeout de `/campus/:id/locations`, que con Madrid se acerca al minuto.
   * Verificado: revienta a los 30 s y responde bien a los 120 s.
   */
  API_TIMEOUT_HEAVY_MS: z.coerce.number().int().positive().default(120_000),
  /**
   * Cuánto tiempo se considera frescos los datos antes de volver a pedir a la API.
   * Las ubicaciones caducan rápido; los proyectos, no.
   */
  CACHE_TTL_CAMPUS_SECONDS: z.coerce.number().int().positive().default(60),
  CACHE_TTL_PROJECTS_SECONDS: z.coerce.number().int().positive().default(900),
  /** Peticiones por página a la API. El máximo de 42 es 100. */
  PAGE_SIZE: z.coerce.number().int().positive().max(100).default(100),
  /**
   * Límite de peticiones por minuto de **nuestro propio** sincronizador.
   * 1200/hora es el tope de la API; 100/min nos deja margen de sobra.
   */
  SYNC_REQUESTS_PER_MINUTE: z.coerce.number().int().positive().default(100),
})

/** Configuración normalizada: el entorno validado más los orígenes ya parseados. */
export type Env = z.infer<typeof envSchema> & {
  /** Orígenes del front permitidos en CORS, sin barra final. */
  readonly allowedOrigins: readonly string[]
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

  return Object.freeze({
    ...parsed,
    allowedOrigins: Object.freeze(origins),
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