/**
 * Tests de la carga de configuración.
 *
 * Comprueban lo que de verdad puede salir mal: variables que faltan, valores
 * mal formados y el detalle fino de CORS, que es donde se rompe el login.
 */

import { describe, expect, it } from 'vitest'
import { loadEnv, REQUIRED_ENV_VARS } from '../../src/config/env.js'

/** Entorno válido de partida. Cada test altera solo lo que necesita. */
function validEnv(): Record<string, string> {
  return {
    FORTY_TWO_UID: 'u-s4t2ud-demo',
    FORTY_TWO_SECRET: 's-s4t2ud-demo',
    FRONTEND_ORIGINS: 'http://localhost:5173',
    FORTY_TWO_REDIRECT_URI: 'http://localhost:3000/auth/callback',
    SESSION_SECRET: 'un-secreto-razonablemente-largo',
    FRONTEND_URL: 'http://localhost:5173',
  }
}

describe('loadEnv', () => {
  it('carga un entorno válido y aplica los valores por defecto', () => {
    const env = loadEnv(validEnv())

    expect(env.PORT).toBe(3000)
    expect(env.CURSUS_ID).toBe(21)
    expect(env.PAGE_SIZE).toBe(100)
    expect(env.DATABASE_PATH).toBe('data/sanatorio.db')
  })

  it.each(REQUIRED_ENV_VARS)('falla si falta %s', (variable) => {
    const source = validEnv()
    // `Reflect.deleteProperty` en vez de `delete`: la clave es dinámica.
    Reflect.deleteProperty(source, variable)

    expect(() => loadEnv(source)).toThrow()
  })

  it('rechaza un SESSION_SECRET demasiado corto', () => {
    const source = { ...validEnv(), SESSION_SECRET: 'corto' }

    expect(() => loadEnv(source)).toThrow(/16 caracteres/)
  })

  it('rechaza una redirect_uri que no es URL', () => {
    const source = { ...validEnv(), FORTY_TWO_REDIRECT_URI: 'no-es-una-url' }

    expect(() => loadEnv(source)).toThrow(/URL válida/)
  })

  it('convierte los números de cadena en número', () => {
    const env = loadEnv({ ...validEnv(), PORT: '8080' })

    expect(env.PORT).toBe(8080)
  })

  it('rechaza un puerto que no es un número', () => {
    expect(() => loadEnv({ ...validEnv(), PORT: 'mil' })).toThrow()
  })

  it('limita PAGE_SIZE al máximo de la API', () => {
    expect(() => loadEnv({ ...validEnv(), PAGE_SIZE: '500' })).toThrow()
  })
})

describe('orígenes permitidos para CORS', () => {
  it('acepta varios orígenes separados por comas', () => {
    const env = loadEnv({
      ...validEnv(),
      FRONTEND_ORIGINS: 'http://localhost:5173,https://sanatorio-42.vercel.app',
    })

    expect(env.allowedOrigins).toEqual(['http://localhost:5173', 'https://sanatorio-42.vercel.app'])
  })

  it('acepta espacios como separador y quita la barra final', () => {
    const env = loadEnv({
      ...validEnv(),
      FRONTEND_ORIGINS: 'http://localhost:5173 https://otro.example/',
    })

    expect(env.allowedOrigins).toEqual(['http://localhost:5173', 'https://otro.example'])
  })

  it('falla si la lista se queda vacía tras limpiar', () => {
    expect(() => loadEnv({ ...validEnv(), FRONTEND_ORIGINS: ' , ' })).toThrow(
      /ningún origen válido/,
    )
  })

  it('devuelve un objeto congelado para que nadie lo mute en runtime', () => {
    const env = loadEnv(validEnv())

    expect(Object.isFrozen(env)).toBe(true)
  })
})
describe('configuración de la API de 42', () => {
  it('deriva la raíz de la API v2 con barra final', () => {
    // La barra importa: si falta, las URLs quedan `https://api.intra.42.frv2/me`.
    const env = loadEnv({ ...validEnv(), FORTY_TWO_API_BASE: 'https://api.intra.42.fr/' })
    expect(env.apiV2Base).toBe('https://api.intra.42.fr/v2')
  })

  it('acepta una base de API alternativa para los tests', () => {
    const env = loadEnv({
      ...validEnv(),
      FORTY_TWO_API_BASE: 'http://127.0.0.1:4010',
      FORTY_TWO_TOKEN_URL: 'http://127.0.0.1:4010/oauth/token',
    })

    expect(env.apiV2Base).toBe('http://127.0.0.1:4010/v2')
  })

  it('pone un User-Agent por defecto, porque la API devuelve 403 sin él', () => {
    const env = loadEnv(validEnv())

    expect(env.FORTY_TWO_USER_AGENT).toContain('sanatorio-42')
  })

  it('permite sobreescribir el User-Agent', () => {
    const env = loadEnv({ ...validEnv(), FORTY_TWO_USER_AGENT: 'mi-proxy/2.0' })

    expect(env.FORTY_TWO_USER_AGENT).toBe('mi-proxy/2.0')
  })

  it('expone el origen del callback de OAuth', () => {
    const env = loadEnv({
      ...validEnv(),
      FORTY_TWO_REDIRECT_URI: 'https://api.sanatorio.example/auth/callback',
    })

    expect(env.oauthRedirectOrigin).toBe('https://api.sanatorio.example')
  })

  it('detecta si el callback apunta al front en vez de al backend', () => {
    // El error clásico: registrar la URL de Vercel como callback. El código
    // llega al front, que no tiene esa ruta, y el login falla en silencio.
    const front = loadEnv({
      ...validEnv(),
      FORTY_TWO_REDIRECT_URI: 'https://sanatorio-42.vercel.app/auth/callback',
    })

    expect(front.oauthRedirectOrigin).toBe('https://sanatorio-42.vercel.app')
    expect(front.oauthRedirectOrigin).not.toBe(front.allowedOrigins[0])
  })
})

describe('scopes de OAuth', () => {
  it('por defecto pide public y profile', () => {
    // El panel de la app 78735 llama `profile` al scope de datos de usuario.
    // Si algún día lo renombran, se cambia en el .env y no en el código.
    expect(loadEnv(validEnv()).oauthScopes).toEqual(['public', 'profile'])
  })

  it('acepta coma o espacios como separador', () => {
    expect(loadEnv({ ...validEnv(), FORTY_TWO_SCOPES: 'public, profile' }).oauthScopes).toEqual([
      'public',
      'profile',
    ])
    expect(
      loadEnv({ ...validEnv(), FORTY_TWO_SCOPES: '  public   profile  ' }).oauthScopes,
    ).toEqual(['public', 'profile'])
  })

  it('quita los scopes en blanco', () => {
    // Un espacio de más llega a la URL como `scope=public  profile`, y 42
    // responde invalid_scope sin decir cuál sobra.
    expect(loadEnv({ ...validEnv(), FORTY_TWO_SCOPES: 'public ,  profile' }).oauthScopes).toEqual([
      'public',
      'profile',
    ])
  })

  it('deja cambiar los scopes sin tocar el código', () => {
    const env = loadEnv({ ...validEnv(), FORTY_TWO_SCOPES: 'public profile projects' })

    expect(env.oauthScopes).toEqual(['public', 'profile', 'projects'])
  })
})
