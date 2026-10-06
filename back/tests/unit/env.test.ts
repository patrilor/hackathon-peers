/**
 * Tests de la configuración.
 *
 * El valor de leer y validar el entorno una sola vez al arrancar está en que un
 * error de configuración sale como un mensaje claro en el log de arranque, y no
 * como un `undefined` que explota tres módulos más abajo y en mitad de una
 * petición. Estos tests fijan ese comportamiento: qué es obligatorio, qué tiene
 * un valor por defecto razonable, y qué se deriva.
 */

import { describe, expect, it } from 'vitest'

import { loadEnv, REQUIRED_ENV_VARS } from '../../src/config/env.js'
import type { Env } from '../../src/config/env.js'

/** Lo mínimo imprescindible, tal y como se define en `REQUIRED_ENV_VARS`. */
const MINIMO: NodeJS.ProcessEnv = {
  FORTY_TWO_UID: 'u-test',
  FORTY_TWO_SECRET: 's-test',
  FORTY_TWO_REDIRECT_URI: 'https://sanatorio-42.vercel.app/api/auth/callback',
  SESSION_SECRET: 'secreto-de-sesion-para-pruebas',
  FRONTEND_URL: 'https://sanatorio-42.vercel.app',
}

describe('configuración', () => {
  it('arranca con solo las variables obligatorias', () => {
    const env = loadEnv(MINIMO)

    expect(env.FORTY_TWO_UID).toBe('u-test')
    expect(env.FRONTEND_URL).toBe('https://sanatorio-42.vercel.app')
  })

  it('falla si falta cada una de las obligatorias', () => {
    for (const variable of REQUIRED_ENV_VARS) {
      // `Reflect.deleteProperty` y no `delete`: la clave se calcula en tiempo de
      // ejecución, y borrarla a lo bruto no está permitido.
      const sinLaVariable: NodeJS.ProcessEnv = { ...MINIMO }
      Reflect.deleteProperty(sinLaVariable, variable)

      expect(() => loadEnv(sinLaVariable)).toThrow()
    }
  })

  it('rechaza un SESSION_SECRET demasiado corto', () => {
    // Menos de 16 caracteres: la firma HMAC dejaría de ser creíble.
    expect(() => loadEnv({ ...MINIMO, SESSION_SECRET: 'corto' })).toThrow(
      /SESSION_SECRET debe tener al menos 16 caracteres/,
    )
  })

  it('rechaza URLs que no son URLs', () => {
    expect(() => loadEnv({ ...MINIMO, FRONTEND_URL: 'no-es-una-url' })).toThrow(
      /FRONTEND_URL debe ser una URL válida/,
    )
    expect(() =>
      loadEnv({ ...MINIMO, FORTY_TWO_REDIRECT_URI: 'sin-protocolo' }),
    ).toThrow(/FORTY_TWO_REDIRECT_URI debe ser una URL válida/)
  })

  it('añade /v2 a la raíz de la API y le quita la barra final', () => {
    const env = loadEnv({ ...MINIMO, FORTY_TWO_API_BASE: 'https://api.intra.42.fr/' })

    expect(env.apiV2Base).toBe('https://api.intra.42.fr/v2')
  })

  it('acepta la API real por defecto, sin tener que declararla', () => {
    expect(loadEnv(MINIMO).apiV2Base).toBe('https://api.intra.42.fr/v2')
  })

  it('acepta FRONTEND_URL con barra final', () => {
    const env = loadEnv({ ...MINIMO, FRONTEND_URL: 'https://sanatorio-42.vercel.app/' })

    expect(env.allowedOrigins).toEqual(['https://sanatorio-42.vercel.app'])
  })

  describe('orígenes permitidos', () => {
    it('usa solo FRONTEND_URL si no se declara FRONTEND_ORIGINS', () => {
      const env = loadEnv(MINIMO)

      expect(env.allowedOrigins).toEqual(['https://sanatorio-42.vercel.app'])
    })

    it('acepta varios orígenes separados por coma o por espacios', () => {
      const env = loadEnv({
        ...MINIMO,
        FRONTEND_ORIGINS: 'http://localhost:5173, https://sanatorio-42.vercel.app/',
      })

      expect(env.allowedOrigins).toEqual([
        'http://localhost:5173',
        'https://sanatorio-42.vercel.app',
      ])
    })

    it('ignora entradas vacías', () => {
      const env = loadEnv({ ...MINIMO, FRONTEND_ORIGINS: ' , , http://localhost:5173 ' })

      expect(env.allowedOrigins).toEqual(['http://localhost:5173'])
    })
  })

  describe('scopes de OAuth', () => {
    it('pide public y profile por defecto, porque sin profile no hay /v2/me', () => {
      expect(loadEnv(MINIMO).oauthScopes).toEqual(['public', 'profile'])
    })

    it('acepta coma o espacios, y quita las entradas vacías', () => {
      const env = loadEnv({ ...MINIMO, FORTY_TWO_SCOPES: 'public,  ,profile' })

      // Un scope en blanco sí llega a la URL de autorización, y 42 responde
      // `invalid_scope` sin decir cuál sobra.
      expect(env.oauthScopes).toEqual(['public', 'profile'])
    })
  })

  describe('base de datos', () => {
    it('usa un fichero local por defecto, sin pedir token', () => {
      const env = loadEnv(MINIMO)

      expect(env.DATABASE_URL).toBe('file:data/sanatorio.db')
      expect(env.isLocalFile).toBe(true)
    })

    it('exige TURSO_AUTH_TOKEN cuando la base es un servidor de Turso', () => {
      expect(() =>
        loadEnv({ ...MINIMO, DATABASE_URL: 'libsql://sanatorio.turso.io' }),
      ).toThrow(/TURSO_AUTH_TOKEN está vacía/)
    })

    it('acepta Turso con su token', () => {
      const env = loadEnv({
        ...MINIMO,
        DATABASE_URL: 'libsql://sanatorio.turso.io',
        TURSO_AUTH_TOKEN: 'token-de-turso',
      })

      expect(env.isLocalFile).toBe(false)
      expect(env.TURSO_AUTH_TOKEN).toBe('token-de-turso')
    })

    it('ignora el token si la base es un fichero local', () => {
      // En desarrollo puede haber un token de Turso en el `.env` sin que estorbe.
      const env = loadEnv({ ...MINIMO, DATABASE_URL: 'file::memory:' })

      expect(env.isLocalFile).toBe(true)
    })
  })

  describe('caché contra la API de 42', () => {
    it('trae presupuestos pensados para caber en una función de Vercel', () => {
      const env = loadEnv(MINIMO)

      // 100 es el máximo por página de la API de 42.
      expect(env.PAGE_SIZE).toBe(100)
      // 5 páginas son ~2,5 s con el límite de 2 peticiones por segundo: por debajo
      // del límite de duración de una función en el plan gratuito.
      expect(env.PEERS_PAGE_BUDGET).toBe(5)
      expect(env.PEERS_TTL_SECONDS).toBe(900)
      expect(env.USER_PROJECTS_TTL_SECONDS).toBe(1800)
    })

    it('lee los números de las cadenas de entorno', () => {
      const env = loadEnv({ ...MINIMO, PAGE_SIZE: '50', PEERS_PAGE_BUDGET: '2' })

      expect(env.PAGE_SIZE).toBe(50)
      expect(env.PEERS_PAGE_BUDGET).toBe(2)
    })

    it('no deja pasar un PAGE_SIZE por encima del tope de la API', () => {
      // Aunque se pase 500, la API nunca manda más de 100 por página.
      expect(() => loadEnv({ ...MINIMO, PAGE_SIZE: '500' })).toThrow()
    })

    it('rechaza un presupuesto de páginas negativo o cero', () => {
      expect(() => loadEnv({ ...MINIMO, PEERS_PAGE_BUDGET: '0' })).toThrow()
      expect(() => loadEnv({ ...MINIMO, PEERS_PAGE_BUDGET: '-1' })).toThrow()
    })

    it('admite un intervalo mínimo de 0, que es "solo manda la API"', () => {
      // Los tests y el desarrollo local no quieren el suelo: lo que manda son las
      // cabeceras de cuota.
      expect(loadEnv({ ...MINIMO, MIN_REQUEST_INTERVAL_MS: '0' }).MIN_REQUEST_INTERVAL_MS).toBe(0)
      // Un intervalo negativo no tiene sentido.
      expect(() => loadEnv({ ...MINIMO, MIN_REQUEST_INTERVAL_MS: '-1' })).toThrow()
    })
  })

  it('devuelve un objeto congelado, para que nadie lo modifique en caliente', () => {
    const env: Env = loadEnv(MINIMO)

    expect(Object.isFrozen(env)).toBe(true)
    expect(() => {
      ;(env as { PORT: number }).PORT = 4000
    }).toThrow()
  })
})