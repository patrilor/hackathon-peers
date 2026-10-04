/**
 * Tests de integración del servidor.
 *
 * Se levanta la app entera y se le habla con `inject`, que hace las peticiones
 * por dentro del proceso: sin puertos, sin red y sin esperar. Lo que se
 * comprueba es el contrato de `docs/api.md` visto desde fuera: códigos de
 * estado, cabeceras y forma de la respuesta.
 */

import { afterEach, describe, expect, it } from 'vitest'

import { cookieValue, json, makeApp } from '../helpers/test-app.js'
import type {
  AvailabilityResponse,
  CurrentUser,
  Peer,
  ProjectSummary,
} from '../../src/domain/types.js'
import type { TestApp } from '../helpers/test-app.js'

const apps: TestApp[] = []

/** App nueva, registrada para poder cerrarla al final del test. */
function app(...args: Parameters<typeof makeApp>): TestApp {
  const built = makeApp(...args)
  apps.push(built)
  return built
}

afterEach(async () => {
  for (const built of apps.splice(0)) {
    await built.close()
  }
})

/** Cabecera `Cookie` con la sesión. */
function asSession(cookie: string): { cookie: string } {
  return { cookie }
}

describe('salud', () => {
  it('GET /health responde 200 sin tocar nada', async () => {
    const built = app()

    const response = await built.app.inject({ method: 'GET', url: '/health' })

    expect(response.statusCode).toBe(200)
    expect(json(response) as { status: string }).toEqual({ status: 'ok' })
  })
})

describe('autenticación', () => {
  it('GET /auth/login redirige a la 42 con state y cookie', async () => {
    const built = app()

    const response = await built.app.inject({ method: 'GET', url: '/auth/login' })

    expect(response.statusCode).toBe(302)
    const location = new URL(String(response.headers.location))
    expect(location.pathname).toBe('/oauth/authorize')
    expect(location.searchParams.get('client_id')).toBe('u-test')
    expect(location.searchParams.get('scope')).toBe('public profile')
    expect(location.searchParams.get('state')).toBeTruthy()
    expect(cookieValue(response.headers['set-cookie'], '__Host-sanatorio_oauth_state')).toBeTruthy()
  })

  it('la cookie de sesión va httpOnly, secure y SameSite=Lax', async () => {
    const built = app()

    const start = await built.app.inject({ method: 'GET', url: '/auth/login' })
    const callback = await built.app.inject({
      method: 'GET',
      url: `/auth/callback?code=codigo&state=${
        new URL(String(start.headers.location)).searchParams.get('state') ?? ''
      }`,
      headers: { cookie: cookieValue(start.headers['set-cookie'], '__Host-sanatorio_oauth_state') },
    })

    const setCookie = (callback.headers['set-cookie'] as string[])
      .map(String)
      .find((cookie) => cookie.startsWith('__Host-sanatorio_session='))
    expect(setCookie).toBeDefined()

    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('Secure')
    // Con SameSite=Strict el navegador no mandaría la cookie de estado al
    // volver de la 42, que es otro origen, y el login nunca funcionaría.
    expect(setCookie).toContain('SameSite=Lax')
    expect(setCookie).toContain('Path=/')
  })

  it('el login completo acaba redirigiendo al front sin query de error', async () => {
    const built = app()
    const start = await built.app.inject({ method: 'GET', url: '/auth/login' })
    const state = new URL(String(start.headers.location)).searchParams.get('state') ?? ''

    const response = await built.app.inject({
      method: 'GET',
      url: `/auth/callback?code=codigo&state=${encodeURIComponent(state)}`,
      headers: { cookie: cookieValue(start.headers['set-cookie'], '__Host-sanatorio_oauth_state') },
    })

    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe('https://front.test')
  })

  it('GET /auth/me devuelve la persona de la sesión', async () => {
    const built = app()
    const cookie = await built.login()

    const response = await built.app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: asSession(cookie),
    })

    expect(response.statusCode).toBe(200)
    expect(json(response) as CurrentUser).toEqual({
      login: 'albrodri',
      image: 'https://img/1.png',
    })
  })

  it('GET /auth/me da 401 sin sesión', async () => {
    const built = app()

    const response = await built.app.inject({ method: 'GET', url: '/auth/me' })

    expect(response.statusCode).toBe(401)
    expect((json(response) as { error: string }).error).toBe('unauthenticated')
  })

  it('GET /auth/me da 401 con una cookie inventada', async () => {
    const built = app()

    const response = await built.app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: '__Host-sanatorio_session=inventada.firma' },
    })

    expect(response.statusCode).toBe(401)
  })

  it('POST /auth/logout borra la sesión y responde 204', async () => {
    const built = app()
    const cookie = await built.login()

    const logout = await built.app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: asSession(cookie),
    })
    expect(logout.statusCode).toBe(204)

    // Y la cookie ya no vale, aunque el navegador la siga mandando.
    const after = await built.app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: asSession(cookie),
    })
    expect(after.statusCode).toBe(401)
  })

  it('un callback sin code va al front con el error', async () => {
    const built = app()
    const start = await built.app.inject({ method: 'GET', url: '/auth/login' })

    const response = await built.app.inject({
      method: 'GET',
      url: '/auth/callback',
      headers: { cookie: cookieValue(start.headers['set-cookie'], '__Host-sanatorio_oauth_state') },
    })

    expect(response.statusCode).toBe(302)
    const location = new URL(String(response.headers.location))
    expect(location.searchParams.get('error')).toBe('invalid_input')
  })

  it('un callback con state plantado va al front con el error', async () => {
    const built = app()
    const start = await built.app.inject({ method: 'GET', url: '/auth/login' })

    const response = await built.app.inject({
      method: 'GET',
      url: '/auth/callback?code=codigo&state=plantado',
      headers: { cookie: cookieValue(start.headers['set-cookie'], '__Host-sanatorio_oauth_state') },
    })

    expect(new URL(String(response.headers.location)).searchParams.get('error')).toBe(
      'invalid_input',
    )
  })
})

describe('proyectos', () => {
  it('GET /me/projects devuelve los proyectos en curso', async () => {
    const built = app()
    const cookie = await built.login()

    const response = await built.app.inject({
      method: 'GET',
      url: '/me/projects',
      headers: asSession(cookie),
    })

    expect(response.statusCode).toBe(200)
    expect(json(response) as ProjectSummary[]).toEqual([{ id: 10, name: 'ft_printf' }])
  })

  it('GET /me/projects da 401 sin sesión', async () => {
    const built = app()

    const response = await built.app.inject({ method: 'GET', url: '/me/projects' })

    expect(response.statusCode).toBe(401)
  })

  it('GET /me/projects devuelve [] si no hay nada en curso', async () => {
    const built = app({}, { routes: { '/v2/users/albrodri/projects_users': [] } })
    const cookie = await built.login()

    const response = await built.app.inject({
      method: 'GET',
      url: '/me/projects',
      headers: asSession(cookie),
    })

    expect(response.statusCode).toBe(200)
    expect(json(response) as ProjectSummary[]).toEqual([])
  })
})

describe('compañeros', () => {
  it('GET /projects/:id/peers devuelve la lista sin quien pregunta', async () => {
    const built = app()
    const cookie = await built.login()

    const response = await built.app.inject({
      method: 'GET',
      url: '/projects/10/peers',
      headers: asSession(cookie),
    })

    expect(response.statusCode).toBe(200)
    const peers = json(response) as Peer[]
    expect(Array.isArray(peers)).toBe(true)
    expect(peers.map((peer) => peer.login)).not.toContain('albrodri')
  })

  it('cada peer trae login, location, available y status', async () => {
    const built = app()
    const cookie = await built.login()

    const response = await built.app.inject({
      method: 'GET',
      url: '/projects/10/peers',
      headers: asSession(cookie),
    })

    for (const peer of json(response) as Peer[]) {
      expect(Object.keys(peer).sort()).toEqual([
        'available',
        'image',
        'location',
        'login',
        'status',
      ])
      expect(typeof peer.available).toBe('boolean')
      expect(['in_progress', 'finished']).toContain(peer.status)
    }
  })

  it('un id que no es un número da 400, no 500', async () => {
    const built = app()
    const cookie = await built.login()

    const response = await built.app.inject({
      method: 'GET',
      url: '/projects/abc/peers',
      headers: asSession(cookie),
    })

    // `Number('abc')` es NaN, y eso en SQLite revienta. Mejor un 400 claro.
    expect(response.statusCode).toBe(400)
    expect((json(response) as { error: string }).error).toBe('invalid_input')
  })

  it('un proyecto desconocido da 404', async () => {
    const built = app()
    const cookie = await built.login()

    const response = await built.app.inject({
      method: 'GET',
      url: '/projects/999/peers',
      headers: asSession(cookie),
    })

    expect(response.statusCode).toBe(404)
    expect((json(response) as { error: string }).error).toBe('not_found')
  })

  it('sin sesión da 401', async () => {
    const built = app()

    const response = await built.app.inject({ method: 'GET', url: '/projects/10/peers' })

    expect(response.statusCode).toBe(401)
  })
})

describe('disponibilidad', () => {
  it('PUT /me/availability guarda y devuelve el valor', async () => {
    const built = app()
    const cookie = await built.login()

    const response = await built.app.inject({
      method: 'PUT',
      url: '/me/availability',
      headers: { ...asSession(cookie), 'content-type': 'application/json' },
      payload: { available: true },
    })

    expect(response.statusCode).toBe(200)
    expect(json(response) as AvailabilityResponse).toEqual({ available: true })

    const read = await built.app.inject({
      method: 'GET',
      url: '/me/availability',
      headers: asSession(cookie),
    })
    expect(json(read) as AvailabilityResponse).toEqual({ available: true })
  })

  it('un body inválido da 400', async () => {
    const built = app()
    const cookie = await built.login()

    const response = await built.app.inject({
      method: 'PUT',
      url: '/me/availability',
      headers: { ...asSession(cookie), 'content-type': 'application/json' },
      payload: { available: 'sí' },
    })

    expect(response.statusCode).toBe(400)
    expect((json(response) as { error: string }).error).toBe('invalid_input')
  })

  it('GET da false si nunca se ha marcado', async () => {
    const built = app()
    const cookie = await built.login()

    const response = await built.app.inject({
      method: 'GET',
      url: '/me/availability',
      headers: asSession(cookie),
    })

    expect(json(response) as AvailabilityResponse).toEqual({ available: false })
  })

  it('sin sesión da 401', async () => {
    const built = app()

    const response = await built.app.inject({
      method: 'PUT',
      url: '/me/availability',
      payload: { available: true },
    })

    expect(response.statusCode).toBe(401)
  })
})

describe('CORS', () => {
  it('devuelve las cabeceras del origen permitido, con credenciales', async () => {
    const built = app()

    const response = await built.app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://front.test' },
    })

    expect(response.headers['access-control-allow-origin']).toBe('https://front.test')
    // Sin esto el navegador no manda la cookie y /auth/me da 401 siempre.
    expect(response.headers['access-control-allow-credentials']).toBe('true')
    expect(response.headers.vary).toBe('Origin')
  })

  it('no devuelve cabeceras para un origen que no está en la lista', async () => {
    const built = app()

    const response = await built.app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://sitio-falso.example' },
    })

    expect(response.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('responde al preflight sin credenciales duplicadas', async () => {
    const built = app()

    const response = await built.app.inject({
      method: 'OPTIONS',
      url: '/me/availability',
      headers: {
        origin: 'https://front.test',
        'access-control-request-method': 'PUT',
      },
    })

    expect(response.statusCode).toBe(204)
    expect(response.headers['access-control-allow-origin']).toBe('https://front.test')
    // El comodín con credenciales es inválido y algunos navegadores lo cortan.
    expect(response.headers['access-control-allow-origin']).not.toBe('*')
  })
})
