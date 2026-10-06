/**
 * Tests del ritmo de peticiones y del token de la aplicación.
 *
 * Los dos borraron al `RateLimiter` y al `TokenManager` que tenía el back antes,
 * así que estos tests son también la prueba de que la sustitución está a la
 * altura de lo que quitó.
 *
 * Todo con reloj y `sleep` falsos: si el test espera de verdad, la suite tarda
 * más que lo que mide.
 */

import { describe, expect, it } from 'vitest'

import { createAppTokenProvider } from '../../src/api/app-token.js'
import { createThrottle } from '../../src/api/throttle.js'
import { createFakeClock, createFakeFetch, createFakeSleep } from '../helpers/fake-api.js'

/** Cabeceras de cuota, tal y como las manda la API real. */
function quota(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    'x-secondly-ratelimit-limit': '2',
    'x-secondly-ratelimit-remaining': '2',
    'x-hourly-ratelimit-limit': '1200',
    'x-hourly-ratelimit-remaining': '1197',
    ...overrides,
  }
}

describe('throttle', () => {
  it('respeta el intervalo mínimo entre peticiones', async () => {
    const clock = createFakeClock()
    const { sleep, waits } = createFakeSleep()
    const throttle = createThrottle({ minIntervalMs: 250, sleep, now: clock.now })

    await throttle.before()
    // El primer `before` no espera nada: no hay petición anterior.
    expect(waits).toEqual([])

    clock.advance(100)
    await throttle.before()
    // Solo han pasado 100 de los 250 ms: faltan 150.
    expect(waits).toEqual([150])
  })

  it('no espera si ya ha pasado el intervalo', async () => {
    const clock = createFakeClock()
    const { sleep, waits } = createFakeSleep()
    const throttle = createThrottle({ minIntervalMs: 250, sleep, now: clock.now })

    await throttle.before()
    clock.advance(500)
    await throttle.before()

    expect(waits).toEqual([])
  })

  it('espera un segundo cuando la cuota por segundo se ha agotado', async () => {
    const clock = createFakeClock()
    const { sleep, waits } = createFakeSleep()
    const throttle = createThrottle({ minIntervalMs: 0, sleep, now: clock.now })

    throttle.observe(new Headers(quota({ 'x-secondly-ratelimit-remaining': '0' })))

    expect(throttle.pendingDelayMs()).toBe(1_000)

    await throttle.before()
    expect(waits).toEqual([1_000])
  })

  it('el retraso forzado es de un uso: a la siguiente ya no espera', async () => {
    const clock = createFakeClock()
    const { sleep, waits } = createFakeSleep()
    const throttle = createThrottle({ minIntervalMs: 0, sleep, now: clock.now })

    throttle.observe(new Headers(quota({ 'x-secondly-ratelimit-remaining': '0' })))
    await throttle.before()
    await throttle.before()

    expect(waits).toEqual([1_000])
  })

  it('estira el ritmo cuando la cuota por hora anda baja, sin parar del todo', async () => {
    const clock = createFakeClock()
    const { sleep, waits } = createFakeSleep()
    const throttle = createThrottle({ minIntervalMs: 0, sleep, now: clock.now })

    throttle.observe(new Headers(quota({ 'x-hourly-ratelimit-remaining': '5' })))

    expect(throttle.pendingDelayMs()).toBe(1_000)

    await throttle.before()
    expect(waits).toEqual([1_000])
  })

  it('guarda la cuota por hora para poder mirarla', () => {
    const throttle = createThrottle({ minIntervalMs: 0, sleep: createFakeSleep().sleep })

    // Antes de preguntar a la API no hay nada que decir.
    expect(throttle.hourlyRemaining()).toBeUndefined()

    throttle.observe(new Headers(quota({ 'x-hourly-ratelimit-remaining': '1197' })))
    expect(throttle.hourlyRemaining()).toBe(1197)

    throttle.observe(new Headers(quota({ 'x-hourly-ratelimit-remaining': '1196' })))
    expect(throttle.hourlyRemaining()).toBe(1196)
  })

  it('no se rompe si la respuesta no trae cabeceras de cuota', () => {
    const clock = createFakeClock()
    const { sleep } = createFakeSleep()
    const throttle = createThrottle({ minIntervalMs: 0, sleep, now: clock.now })

    // Un mock, o una respuesta de error sin cabeceras: el throttle no debe
    // inventarse un retraso ni romperse.
    throttle.observe(new Headers())

    expect(throttle.pendingDelayMs()).toBe(0)
    expect(throttle.hourlyRemaining()).toBeUndefined()
  })

  it('encadena las peticiones para que no salgan dos en el mismo instante', async () => {
    const clock = createFakeClock()
    const { sleep, waits } = createFakeSleep()
    const throttle = createThrottle({ minIntervalMs: 100, sleep, now: clock.now })

    // Dos `before` seguidos sin esperar entre ellos: la segunda tiene que
    // esperar a que la primera termine, o ambas se llevarían la misma ventana de
    // un segundo y la API respondería 429 a una.
    const first = throttle.before()
    const second = throttle.before()
    await Promise.all([first, second])

    expect(waits).toEqual([100])
  })
})

describe('token de la aplicación', () => {
  function provider(fetchImpl: typeof fetch) {
    return createAppTokenProvider({
      tokenUrl: 'https://api.intra.42.fr/oauth/token',
      uid: 'u-test',
      secret: 's-test',
      userAgent: 'test/1.0',
      fetchImpl,
      skewMs: 60_000,
    })
  }

  it('pide el token con client_credentials y en Basic', async () => {
    const fake = createFakeFetch([{ body: { access_token: 'token-abc', expires_in: 7200 } }])
    const tokens = provider(fake.fetchImpl)

    expect(await tokens.getToken()).toBe('token-abc')

    const init = fake.calls[0]?.init
    expect(init?.method).toBe('POST')
    expect(fake.headersOf(0).Authorization).toBe(
      `Basic ${Buffer.from('u-test:s-test').toString('base64')}`,
    )
    expect(fake.bodyOf(0)).toContain('grant_type=client_credentials')
  })

  it('reutiliza el token mientras siga vivo', async () => {
    const fake = createFakeFetch([{ body: { access_token: 'token-abc', expires_in: 7200 } }])
    const tokens = provider(fake.fetchImpl)

    await tokens.getToken()
    await tokens.getToken()
    await tokens.getToken()

    // Tres usos, una sola petición: pedir un token es una de las 1 200 por hora.
    expect(fake.calls).toHaveLength(1)
  })

  it('pide uno solo cuando varios lo piden a la vez', async () => {
    const fake = createFakeFetch([{ body: { access_token: 'token-abc', expires_in: 7200 } }])
    const tokens = provider(fake.fetchImpl)

    // Cold start de Vercel con dos peticiones a la vez: no se pueden pedir dos
    // tokens ni bloquearse la una a la otra.
    const [a, b, c] = await Promise.all([tokens.getToken(), tokens.getToken(), tokens.getToken()])

    expect([a, b, c]).toEqual(['token-abc', 'token-abc', 'token-abc'])
    expect(fake.calls).toHaveLength(1)
  })

  it('da el token por caducado antes de que lo esté, para no ir con uno muerto', async () => {
    const fake = createFakeFetch([
      { body: { access_token: 'corto', expires_in: 30 } },
      { body: { access_token: 'nuevo', expires_in: 7200 } },
    ])
    const tokens = provider(fake.fetchImpl)

    // `expires_in: 30` con 60 s de margen: ya está vencido para nosotros.
    expect(await tokens.getToken()).toBe('corto')
    expect(await tokens.getToken()).toBe('nuevo')
  })

  it('vuelve a pedir token tras un invalidate', async () => {
    const fake = createFakeFetch([{ body: { access_token: 'token-abc', expires_in: 7200 } }])
    const tokens = provider(fake.fetchImpl)

    await tokens.getToken()
    tokens.invalidate()
    await tokens.getToken()

    expect(fake.calls).toHaveLength(2)
  })

  it('da un error claro si la respuesta no trae access_token', async () => {
    const fake = createFakeFetch([{ body: { error: 'invalid_client' } }])
    const tokens = provider(fake.fetchImpl)

    await expect(tokens.getToken()).rejects.toThrow(/no trae access_token/)
  })

  it('da un error claro si el secreto no vale', async () => {
    const fake = createFakeFetch([{ status: 401, text: 'invalid_client' }])
    const tokens = provider(fake.fetchImpl)

    await expect(tokens.getToken()).rejects.toThrow(/No se pudo pedir el token/)
  })

  it('manda el User-Agent, que la API de 42 exige', async () => {
    const fake = createFakeFetch([{ body: { access_token: 'token-abc', expires_in: 7200 } }])
    const tokens = provider(fake.fetchImpl)

    await tokens.getToken()

    expect(fake.headersOf(0)['User-Agent']).toBe('test/1.0')
  })
})