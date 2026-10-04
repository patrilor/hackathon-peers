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
    expect(env.CAMPUS_ID).toBe(22)
    expect(env.CURSUS_ID).toBe(21)
    expect(env.PAGE_SIZE).toBe(100)
    expect(env.DATABASE_PATH).toBe('data/sanatorio.db')
  })

  it.each(REQUIRED_ENV_VARS)('falla si falta %s', (variable) => {
    const source = validEnv()
    delete source[variable]

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
    const env = loadEnv({ ...validEnv(), PORT: '8080', CAMPUS_ID: '9' })

    expect(env.PORT).toBe(8080)
    expect(env.CAMPUS_ID).toBe(9)
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

    expect(env.allowedOrigins).toEqual([
      'http://localhost:5173',
      'https://sanatorio-42.vercel.app',
    ])
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