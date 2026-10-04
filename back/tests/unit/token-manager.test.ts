/**
 * Tests del gestor de token.
 *
 * Dos cosas que se pagan caras si fallan: pedir tokens de más (cada uno es una
 * petición que cuenta para el rate limit) y usar uno que caduca a mitad de una
 * sincronización (provoca un 401 y obliga a repetir trabajo).
 */

import { describe, expect, it } from 'vitest'

import { TokenManager } from '../../src/api/token-manager.js'
import { createFakeClock, createFakeFetch } from '../helpers/fake-api.js'

/** Gestor con todo inyectado. */
function makeManager(
  queue: Parameters<typeof createFakeFetch>[0],
  overrides: { refreshMarginMs?: number; tokenUrl?: string } = {},
) {
  const fake = createFakeFetch(queue)
  const clock = createFakeClock()

  const manager = new TokenManager({
    tokenUrl: overrides.tokenUrl ?? 'https://api.test/oauth/token',
    uid: 'u-s4t2ud-test',
    secret: 's-secret-test',
    userAgent: 'sanatorio-42-test/1.0',
    refreshMarginMs: overrides.refreshMarginMs ?? 60_000,
    now: clock.now,
    fetchImpl: fake.fetchImpl,
  })

  return { manager, fake, clock }
}

describe('TokenManager', () => {
  it('pide el token la primera vez', async () => {
    const { manager, fake } = makeManager([
      { body: { access_token: 'abc123', token_type: 'bearer', expires_in: 3600 } },
    ])

    await expect(manager.getToken()).resolves.toBe('abc123')
    expect(fake.calls).toHaveLength(1)
  })

  it('reutiliza el token mientras sea válido', async () => {
    const { manager, fake } = makeManager([
      { body: { access_token: 'abc123', token_type: 'bearer', expires_in: 3600 } },
    ])

    await manager.getToken()
    await manager.getToken()
    await manager.getToken()

    // Tres usos, una sola petición a /oauth/token.
    expect(fake.calls).toHaveLength(1)
  })

  it('renueva antes de que caduque, no al caducar', async () => {
    const { manager, fake, clock } = makeManager([
      { body: { access_token: 'primero', token_type: 'bearer', expires_in: 3600 } },
      { body: { access_token: 'segundo', token_type: 'bearer', expires_in: 3600 } },
    ])

    await expect(manager.getToken()).resolves.toBe('primero')

    // 3600 s de validez con margen de 60 s: a los 3550 s ya hay que renovar.
    clock.advance(3_550_000)
    await expect(manager.getToken()).resolves.toBe('segundo')

    expect(fake.calls).toHaveLength(2)
  })

  it('NO renueva un token que aún está lejos de caducar', async () => {
    const { manager, fake, clock } = makeManager([
      { body: { access_token: 'primero', token_type: 'bearer', expires_in: 3600 } },
    ])

    await manager.getToken()
    clock.advance(1_000_000)

    await expect(manager.getToken()).resolves.toBe('primero')
    expect(fake.calls).toHaveLength(1)
  })

  it('hace una sola petición si llegan muchas a la vez (single-flight)', async () => {
    const { manager, fake } = makeManager([
      { body: { access_token: 'unico', token_type: 'bearer', expires_in: 3600 } },
    ])

    // Diez llamadas simultáneas con el token caducado. Sin single-flight,
    // serían diez peticiones a /oauth/token y nos comemos el rate limit.
    const tokens = await Promise.all([
      manager.getToken(),
      manager.getToken(),
      manager.getToken(),
      manager.getToken(),
      manager.getToken(),
      manager.getToken(),
      manager.getToken(),
      manager.getToken(),
      manager.getToken(),
      manager.getToken(),
    ])

    expect(new Set(tokens)).toEqual(new Set(['unico']))
    expect(fake.calls).toHaveLength(1)
  })

  it('permite pedir de nuevo tras un invalidate()', async () => {
    const { manager, fake } = makeManager([
      { body: { access_token: 'primero', token_type: 'bearer', expires_in: 3600 } },
      { body: { access_token: 'segundo', token_type: 'bearer', expires_in: 3600 } },
    ])

    await expect(manager.getToken()).resolves.toBe('primero')
    manager.invalidate()
    await expect(manager.getToken()).resolves.toBe('segundo')

    expect(fake.calls).toHaveLength(2)
  })

  it('no se queda pillado si la petición falla', async () => {
    const { manager, fake } = makeManager([
      { status: 401, text: '{"message":"invalid client"}' },
      { body: { access_token: 'recuperado', token_type: 'bearer', expires_in: 3600 } },
    ])

    await expect(manager.getToken()).rejects.toMatchObject({ code: 'unauthorized' })
    // La siguiente llamada tiene que poder intentarlo otra vez.
    await expect(manager.getToken()).resolves.toBe('recuperado')
    expect(fake.calls).toHaveLength(2)
  })

  it('manda Basic auth y el grant_type correctos', async () => {
    const { manager, fake } = makeManager([
      { body: { access_token: 'abc', token_type: 'bearer', expires_in: 3600 } },
    ])

    await manager.getToken()

    const headers = fake.headersOf(0)
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from('u-s4t2ud-test:s-secret-test').toString('base64')}`,
    )
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded')
    // Sin User-Agent la 42 responde 403 con el cuerpo vacío.
    expect(headers['User-Agent']).toBe('sanatorio-42-test/1.0')

    expect(new URLSearchParams(fake.bodyOf(0) ?? '').get('grant_type')).toBe('client_credentials')
  })

  it('falla si la respuesta no trae access_token', async () => {
    const { manager } = makeManager([{ body: { token_type: 'bearer', expires_in: 3600 } }])

    await expect(manager.getToken()).rejects.toThrow(/no trae access_token/)
  })

  it('asume 30 minutos si la API no dice expires_in', async () => {
    const { manager, clock } = makeManager([
      { body: { access_token: 'abc', token_type: 'bearer' } },
    ])

    await manager.getToken()
    const cached = manager.peek()

    expect(cached).toBeDefined()
    expect((cached?.expiresAt ?? 0) - clock.now()).toBe(1_800_000)
  })

  it('mapea un fallo de red a un error tipado', async () => {
    const { manager } = makeManager([{ throws: new Error('ECONNREFUSED') }])

    await expect(manager.getToken()).rejects.toMatchObject({
      code: 'network_error',
      endpoint: '/oauth/token',
    })
  })

  it('peek() devuelve null antes de pedir el primer token', () => {
    const { manager } = makeManager([{ body: { access_token: 'abc', expires_in: 3600 } }])

    expect(manager.peek()).toBeNull()
  })
})
