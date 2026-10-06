/**
 * Tests del puente Vercel ↔ Fastify (`src/vercel.ts`).
 *
 * En Vercel no hay puerto: cada petición llega como `Request` y hay que
 * devolver `Response`. Aquí se comprueba que ese puente deja Fastify igual que
 * cuando se le habla con `inject` de verdad: mismos códigos, mismas cookies,
 * mismo cuerpo, y que el prefijo `/api` (que solo existe en Vercel) se quita
 * justo una vez.
 */

import { afterEach, describe, expect, it } from 'vitest'

import { atender, rutaSinPrefijo } from '../../src/vercel.js'
import { cookieValue, makeApp } from '../helpers/test-app.js'
import type { TestApp } from '../helpers/test-app.js'

const apps: TestApp[] = []

/** App nueva, registrada para poder cerrarla al final del test. */
async function app(): Promise<TestApp> {
  const built = await makeApp()
  apps.push(built)
  return built
}

afterEach(async () => {
  for (const built of apps.splice(0)) {
    await built.close()
  }
})

/** Petición de Vercel contra un dominio de mentira: solo se lee la URL. */
function peticion(ruta: string, init?: RequestInit): Request {
  return new Request(`https://sanatorio-42.vercel.app${ruta}`, init)
}

describe('rutaSinPrefijo', () => {
  it('quita el prefijo /api que solo existe en Vercel', () => {
    expect(rutaSinPrefijo(new URL('https://x/api/auth/me'))).toBe('/auth/me')
    expect(rutaSinPrefijo(new URL('https://x/api/me/availability'))).toBe('/me/availability')
    expect(rutaSinPrefijo(new URL('https://x/api/projects/10/peers'))).toBe('/projects/10/peers')
  })

  it('deja las rutas sin prefijo tal cual', () => {
    expect(rutaSinPrefijo(new URL('https://x/health'))).toBe('/health')
  })

  it('trata /api solo como la raíz del prefijo', () => {
    expect(rutaSinPrefijo(new URL('https://x/api'))).toBe('/')
    // Una ruta que empieza igual pero no es el prefijo no debe recortarse.
    expect(rutaSinPrefijo(new URL('https://x/apialgo'))).toBe('/apialgo')
  })
})

describe('atender', () => {
  it('responde como Fastify a través del puente', async () => {
    const built = await app()

    const response = await atender(peticion('/api/health'), built)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  it('devuelve 401 de Fastify cuando no hay sesión', async () => {
    const built = await app()

    const response = await atender(peticion('/api/auth/me'), built)

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ error: 'unauthenticated' })
  })

  it('conserva la query', async () => {
    const built = await app()

    const response = await atender(peticion('/api/auth/me?origen=vercel'), built)

    expect(response.status).toBe(401)
  })

  it('pasa el cuerpo al parser de Fastify (PUT con JSON)', async () => {
    const built = await app()

    // Si el cuerpo no llegara, Fastify respondería 400 por JSON inválido en vez
    // de 401 por falta de sesión: el orden solo se cumple si el payload viaja.
    const response = await atender(
      peticion('/api/me/availability', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ available: true }),
      }),
      built,
    )

    expect(response.status).toBe(401)
  })

  it('copia las dos cookies del redirect de login', async () => {
    const built = await app()

    const response = await atender(peticion('/api/auth/login'), built)

    expect(response.status).toBe(302)
    expect(new URL(response.headers.get('location') ?? '').pathname).toBe('/oauth/authorize')
    // `set-cookie` se repite y `Headers` lo admite; con `set`, la segunda cookie
    // (la de sesión) borraría la primera (la del state) y el login rompería.
    const cookies = response.headers.getSetCookie()
    expect(cookies.some((cookie) => cookie.startsWith('__Host-sanatorio_oauth_state='))).toBe(true)
    expect(cookieValue(cookies, '__Host-sanatorio_oauth_state')).toBeTruthy()
  })

  it('el cuerpo de 204 sale sin cuerpo y sin content-length', async () => {
    const built = await app()
    const session = await built.login()

    const response = await atender(
      peticion('/api/auth/logout', { method: 'POST', headers: { cookie: session } }),
      built,
    )

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(response.headers.get('content-length')).toBeNull()
  })

  it('rechaza con 405 los métodos que Fastify no conoce', async () => {
    const built = await app()

    const response = await atender(peticion('/api/health', { method: 'SEARCH' }), built)

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toContain('GET')
  })
})
