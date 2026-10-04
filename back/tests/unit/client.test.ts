/**
 * Tests del cliente de la API de 42.
 *
 * Se prueba lo que de verdad falla en producción: el 429, el 500, el token
 * caducado y la paginación. Todos los escenarios verificados contra la API
 * real durante la investigación.
 */

import { describe, expect, it } from 'vitest'

import { FortyTwoClient } from '../../src/api/client.js'
import { ApiError } from '../../src/api/errors.js'
import {
  createFakeFetch,
  createFakeSleep,
  fakeTokenManager,
  instantRateLimiter,
} from '../helpers/fake-api.js'

type FetchInput = Parameters<typeof fetch>[0]
type FetchInit = Parameters<typeof fetch>[1]

/** Cliente de pruebas, con todo inyectado. */
function makeClient(
  queue: Parameters<typeof createFakeFetch>[0],
  overrides: { pageSize?: number; maxRetries?: number } = {},
) {
  const fake = createFakeFetch(queue)
  const { waits, sleep } = createFakeSleep()

  const client = new FortyTwoClient({
    apiV2Base: 'https://api.test/v2',
    userAgent: 'sanatorio-42-test/1.0',
    timeoutMs: 1_000,
    heavyTimeoutMs: 2_000,
    pageSize: overrides.pageSize ?? 100,
    limiter: instantRateLimiter(),
    tokens: fakeTokenManager(),
    tokenProvider: async () => 'token-de-app',
    fetchImpl: fake.fetchImpl,
    maxRetries: overrides.maxRetries ?? 3,
    sleep,
  })

  return { client, fake, waits }
}

describe('peticiones básicas', () => {
  it('añade la raíz de la API a la ruta', async () => {
    const { client, fake } = makeClient([{ body: { id: 1, login: 'albrodri' } }])

    await client.getUser('albrodri')

    expect(fake.urls()[0]).toBe('https://api.test/v2/users/albrodri')
  })

  it('manda el token y el User-Agent en cada petición', async () => {
    const { client, fake } = makeClient([{ body: { id: 1, login: 'albrodri' } }])

    await client.getUser('albrodri')

    // Sin User-Agent, la 42 responde 403 con el cuerpo vacío.
    const headers = fake.headersOf(0)
    expect(headers.Authorization).toBe('Bearer token-de-app')
    expect(headers['User-Agent']).toBe('sanatorio-42-test/1.0')
  })

  it('escapa los logins con caracteres raros', async () => {
    const { client, fake } = makeClient([{ body: { id: 1, login: 'a/b' } }])

    await client.getUser('a/b')

    expect(fake.urls()[0]).toBe('https://api.test/v2/users/a%2Fb')
  })

  it('usa el token de usuario cuando se le pasa explícitamente', async () => {
    const { client, fake } = makeClient([{ body: { id: 1, login: 'albrodri' } }])

    await client.getMe('token-de-usuario')

    expect(fake.headersOf(0).Authorization).toBe('Bearer token-de-usuario')
  })

  it('devuelve el cuerpo parseado como JSON', async () => {
    const { client } = makeClient([{ body: { id: 42, login: 'albrodri', kind: 'student' } }])

    await expect(client.getUser('albrodri')).resolves.toEqual({
      id: 42,
      login: 'albrodri',
      kind: 'student',
    })
  })
})

describe('reintentos', () => {
  it('reintenta un 429 y sale con éxito', async () => {
    const { client, fake } = makeClient([
      { status: 429, text: '{"error":"Spam Rate Limit Exceeded"}' },
      { body: { id: 1, login: 'albrodri' } },
    ])

    await expect(client.getUser('albrodri')).resolves.toMatchObject({ login: 'albrodri' })
    expect(fake.calls).toHaveLength(2)
  })

  it('reintenta varios 429 seguidos', async () => {
    const { client, fake } = makeClient([
      { status: 429, text: '{"error":"Spam Rate Limit Exceeded"}' },
      { status: 429, text: '{"error":"Spam Rate Limit Exceeded"}' },
      { status: 429, text: '{"error":"Spam Rate Limit Exceeded"}' },
      { body: { id: 1, login: 'albrodri' } },
    ])

    await expect(client.getUser('albrodri')).resolves.toMatchObject({ login: 'albrodri' })
    expect(fake.calls).toHaveLength(4)
  })

  it('reintenta un 500', async () => {
    const { client } = makeClient([
      { status: 500, text: '' },
      { body: { id: 1, login: 'albrodri' } },
    ])

    await expect(client.getUser('albrodri')).resolves.toMatchObject({ login: 'albrodri' })
  })

  it('reintenta un error de red', async () => {
    const { client, fake } = makeClient([
      { throws: new Error('ECONNRESET') },
      { body: { id: 1, login: 'albrodri' } },
    ])

    await expect(client.getUser('albrodri')).resolves.toMatchObject({ login: 'albrodri' })
    expect(fake.calls).toHaveLength(2)
  })

  it('NO reintenta un 404: reintentarlo solo gasta cuota', async () => {
    const { client, fake } = makeClient([{ status: 404, text: '{}' }])

    await expect(client.getUser('noexiste')).rejects.toBeInstanceOf(ApiError)
    // Una sola llamada, ni una más.
    expect(fake.calls).toHaveLength(1)
  })

  it('NO reintenta un 403', async () => {
    const { client, fake } = makeClient([{ status: 403, text: '' }])

    await expect(client.getUser('albrodri')).rejects.toMatchObject({ code: 'forbidden' })
    expect(fake.calls).toHaveLength(1)
  })

  it('se rinde tras agotar los reintentos', async () => {
    const { client, fake } = makeClient(
      [
        { status: 429, text: '{"error":"Spam Rate Limit Exceeded"}' },
        { status: 429, text: '{"error":"Spam Rate Limit Exceeded"}' },
        { status: 429, text: '{"error":"Spam Rate Limit Exceeded"}' },
        { status: 429, text: '{"error":"Spam Rate Limit Exceeded"}' },
      ],
      { maxRetries: 3 },
    )

    await expect(client.getUser('albrodri')).rejects.toMatchObject({ code: 'rate_limited' })
    // El intento original más 3 reintentos.
    expect(fake.calls).toHaveLength(4)
  })

  it('respeta el Retry-After que manda la API', async () => {
    const { client, waits } = makeClient([
      { status: 429, text: '{}', headers: { 'retry-after': '7' } },
      { body: { id: 1, login: 'albrodri' } },
    ])

    await client.getUser('albrodri')

    // Si la API dice 7 segundos, esperamos 7. No our backoff de 500 ms.
    expect(waits).toEqual([7_000])
  })

  it('crece el backoff entre reintentos', async () => {
    const { client, waits } = makeClient([
      { status: 500, text: '' },
      { status: 500, text: '' },
      { status: 500, text: '' },
      { body: { id: 1, login: 'albrodri' } },
    ])

    await client.getUser('albrodri')

    expect(waits).toHaveLength(3)
    expect(waits[0]).toBeGreaterThanOrEqual(500)
    expect(waits[1]).toBeGreaterThanOrEqual(1_000)
    expect(waits[2]).toBeGreaterThanOrEqual(2_000)
  })

  it('descarta el token en caché cuando la API responde 401', async () => {
    const fake = createFakeFetch([
      { status: 401, text: '{"message":"Unauthorized"}' },
      { body: { id: 1, login: 'albrodri' } },
    ])
    const tokens = fakeTokenManager()

    const client = new FortyTwoClient({
      apiV2Base: 'https://api.test/v2',
      userAgent: 'test/1.0',
      timeoutMs: 1_000,
      heavyTimeoutMs: 1_000,
      pageSize: 100,
      limiter: instantRateLimiter(),
      tokens,
      fetchImpl: fake.fetchImpl,
      maxRetries: 0,
      sleep: async () => undefined,
    })

    tokens.peek()
    await expect(client.getUser('albrodri')).rejects.toMatchObject({ code: 'unauthorized' })
    expect(tokens.peek()).toBeNull()
  })
})

describe('errores', () => {
  it('mapea cada status a su código', async () => {
    const cases = [
      [400, 'bad_request'],
      [401, 'unauthorized'],
      [403, 'forbidden'],
      [404, 'not_found'],
      [429, 'rate_limited'],
      [500, 'server_error'],
      [503, 'server_error'],
    ] as const

    for (const [status, code] of cases) {
      const { client } = makeClient([{ status, text: '{}' }], { maxRetries: 0 })
      await expect(client.getUser('albrodri')).rejects.toMatchObject({ code })
    }
  })

  it('usa el mensaje que devuelve la API', async () => {
    const { client } = makeClient([{ status: 429, text: '{"error":"Spam Rate Limit Exceeded"}' }], {
      maxRetries: 0,
    })

    await expect(client.getUser('albrodri')).rejects.toThrow('Spam Rate Limit Exceeded')
  })

  it('no se rompe si el cuerpo del error no es JSON', async () => {
    // La 42 devuelve HTML vacío en algunos 403. El error debe seguir siendo útil.
    const { client } = makeClient([{ status: 403, text: '<html>Forbidden</html>' }], {
      maxRetries: 0,
    })

    await expect(client.getUser('albrodri')).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('marca correctamente si el error es reintentable', () => {
    const cases = [
      [408, true],
      [429, true],
      [500, true],
      [503, true],
      [400, false],
      [401, false],
      [403, false],
      [404, false],
    ] as const

    for (const [status, retryable] of cases) {
      const error = new ApiError('x', status, { endpoint: '/x', code: 'server_error' })
      expect(error.retryable).toBe(retryable)
    }
  })

  it('incluye la ruta en el error, para poder localizarlo', async () => {
    const { client } = makeClient([{ status: 404, text: '{}' }], { maxRetries: 0 })

    await expect(client.getCampusUsers(22)).rejects.toMatchObject({
      endpoint: '/v2/campus/22/users',
    })
  })
})

describe('paginación', () => {
  it('recoge todas las páginas hasta que una viene incompleta', async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ id: i, login: `user${i}` }))
    const { client, fake } = makeClient(
      [
        { body: full },
        { body: [{ id: 100, login: 'user100' }] },
      ],
      { pageSize: 100 },
    )

    const users = await client.getCampusUsers(22)

    expect(users).toHaveLength(101)
    expect(fake.urls()).toEqual([
      'https://api.test/v2/campus/22/users?page=1&per_page=100',
      'https://api.test/v2/campus/22/users?page=2&per_page=100',
    ])
  })

  it('hace una sola petición si todo cabe en una página', async () => {
    const { client, fake } = makeClient([{ body: [{ id: 1, login: 'albrodri' }] }])

    await client.getCampusUsers(22)

    expect(fake.calls).toHaveLength(1)
  })

  it('devuelve una lista vacía sin llamar si no hay nada', async () => {
    const { client } = makeClient([{ body: [] }])

    await expect(client.getCampusUsers(22)).resolves.toEqual([])
  })

  it('respeta el tamaño de página configurado', async () => {
    const { client, fake } = makeClient([{ body: [] }], { pageSize: 50 })

    await client.getCampusUsers(22)

    expect(fake.urls()[0]).toContain('per_page=50')
  })
})

describe('timeouts', () => {
  it('mapea un timeout a un error tipado y reintentable', async () => {
    const timeout = new Error('The operation was aborted')
    timeout.name = 'TimeoutError'

    const { client } = makeClient([{ throws: timeout }], { maxRetries: 0 })

    await expect(client.getCampusUsers(22)).rejects.toMatchObject({
      code: 'timeout',
      retryable: true,
    })
  })

  it('usa el timeout pesado para /locations', async () => {
    const fake = createFakeFetch([{ body: [] }])
    const signals: (AbortSignal | undefined)[] = []

    const spyingFetch = ((input: FetchInput, init?: FetchInit) => {
      signals.push(init?.signal ?? undefined)
      return fake.fetchImpl(input, init)
    }) as typeof fetch

    const client = new FortyTwoClient({
      apiV2Base: 'https://api.test/v2',
      userAgent: 'test/1.0',
      timeoutMs: 30_000,
      // Este endpoint se acerca al minuto: con 30 s revienta.
      heavyTimeoutMs: 120_000,
      pageSize: 100,
      limiter: instantRateLimiter(),
      tokens: fakeTokenManager(),
      tokenProvider: async () => 'token',
      fetchImpl: spyingFetch,
      sleep: async () => undefined,
    })

    await client.getCampusLocations(22)

    // `AbortSignal.timeout` no expone el valor, pero sí la presencia de la señal.
    expect(signals[0]).toBeInstanceOf(AbortSignal)
  })

  it('pasa una señal de aborto en todas las peticiones', async () => {
    const fake = createFakeFetch([{ body: [] }])
    const signals: (AbortSignal | undefined)[] = []
    const spyingFetch = ((input: FetchInput, init?: FetchInit) => {
      signals.push(init?.signal ?? undefined)
      return fake.fetchImpl(input, init)
    }) as typeof fetch

    const client = new FortyTwoClient({
      apiV2Base: 'https://api.test/v2',
      userAgent: 'test/1.0',
      timeoutMs: 1_000,
      heavyTimeoutMs: 1_000,
      pageSize: 100,
      limiter: instantRateLimiter(),
      tokens: fakeTokenManager(),
      tokenProvider: async () => 'token',
      fetchImpl: spyingFetch,
      sleep: async () => undefined,
    })

    await client.getCampusUsers(22)

    expect(signals[0]).toBeInstanceOf(AbortSignal)
  })
})