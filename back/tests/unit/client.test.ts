/**
 * Tests del cliente de la API de 42.
 *
 * Lo que más importa aquí es la paginación y el presupuesto de tiempo: el
 * proyecto 2689 son 21 páginas y la API va a 2 peticiones por segundo, así que
 * cualquier cambio en cómo se piden las páginas se nota en la latencia que ve
 * quien está usando la web.
 */

import { describe, expect, it } from 'vitest'

import { FortyTwoClient } from '../../src/api/client.js'
import { createThrottle } from '../../src/api/throttle.js'
import { createFakeFetch, createFakeSleep, stubAppTokens } from '../helpers/fake-api.js'

const BASE = 'https://api.intra.42.fr/v2'

function makeClient(
  queue: Parameters<typeof createFakeFetch>[0],
  overrides: {
    pageSize?: number
    maxRetries?: number
    quota?: Record<string, string>
  } = {},
) {
  const fake = createFakeFetch(queue, {
    'x-secondly-ratelimit-limit': '2',
    'x-secondly-ratelimit-remaining': '2',
    'x-hourly-ratelimit-limit': '1200',
    'x-hourly-ratelimit-remaining': '1197',
    ...overrides.quota,
  })
  const { sleep, waits } = createFakeSleep()
  const tokens = stubAppTokens()

  const client = new FortyTwoClient({
    apiV2Base: BASE,
    userAgent: 'test/1.0',
    timeoutMs: 1_000,
    pageSize: overrides.pageSize ?? 100,
    // Sin espera: el ritmo se prueba en `throttle.test.ts` con reloj falso.
    throttle: createThrottle({ minIntervalMs: 0, sleep }),
    tokens: tokens.provider,
    fetchImpl: fake.fetchImpl,
    maxRetries: overrides.maxRetries ?? 2,
    sleep,
  })

  return { client, fake, waits, tokens }
}

describe('cliente de 42', () => {
  describe('cabeceras y autenticación', () => {
    it('manda el token, el User-Agent y pide JSON', async () => {
      const { client, fake } = makeClient([{ body: [] }])

      await client.getProjectParticipantsPage(2689)

      const headers = fake.headersOf(0)
      expect(headers.Authorization).toBe('Bearer token-de-app')
      expect(headers['User-Agent']).toBe('test/1.0')
      expect(headers.Accept).toBe('application/json')
    })

    it('filtra por proyecto y pide una página concreta', async () => {
      const { client, fake } = makeClient([{ body: [] }])

      await client.getProjectParticipantsPage(2689, 7)

      // `filter[project_id]` con corchetes sin codificar: es como lo acepta la 42.
      expect(fake.urls()[0]).toBe(`${BASE}/projects_users?filter[project_id]=2689&page=7&per_page=100`)
    })

    it('codifica el login en la URL de proyectos', async () => {
      const { client, fake } = makeClient([{ body: [] }])

      await client.getUserProjects('albrodri')

      expect(fake.urls()[0]).toContain('/users/albrodri/projects_users')
    })
  })

  describe('paginación', () => {
    it('devuelve una página y su total, leyendo las cabeceras', async () => {
      const { client } = makeClient([
        {
          body: [{ status: 'in_progress', user: { login: 'albrodri' } }],
          headers: { 'x-total': '2047', 'x-per-page': '100' },
        },
      ])

      const page = await client.getProjectParticipantsPage(2689)

      expect(page.total).toBe(2047)
      expect(page.perPage).toBe(100)
      expect(page.items).toHaveLength(1)
    })

    it('asume que es todo si la API no manda X-Total', async () => {
      const { client } = makeClient([{ body: [{ status: 'in_progress' }, { status: 'finished' }] }])

      const page = await client.getProjectParticipantsPage(2689)

      // Sin `X-Total` se asume que lo que ha venido es el proyecto completo: es
      // mejor servir lo que hay que no servir nada.
      expect(page.total).toBe(2)
    })

    it('rechaza una respuesta que no es una lista', async () => {
      const { client } = makeClient([{ body: { error: 'nope' } }])

      await expect(client.getProjectParticipantsPage(2689)).rejects.toThrow(/no ha devuelto una lista/)
    })

    it('recorre todas las páginas de los proyectos de una persona', async () => {
      const { client, fake } = makeClient(
        [
          {
            body: Array.from({ length: 100 }, (_, index) => ({
              status: 'in_progress',
              project: { id: index },
            })),
            headers: { 'x-total': '101', 'x-per-page': '100' },
          },
          { body: [{ status: 'in_progress', project: { id: 100 } }], headers: { 'x-total': '101' } },
        ],
        { pageSize: 100 },
      )

      const projects = await client.getUserProjects('albrodri')

      expect(projects).toHaveLength(101)
      // Dos peticiones: la segunda, al venir corta, significa "ya no hay más".
      expect(fake.calls).toHaveLength(2)
      expect(fake.urls()[1]).toContain('page=2')
    })

    it('no pide una segunda página si la primera vino corta', async () => {
      const { client, fake } = makeClient([{ body: [{ status: 'in_progress', project: { id: 1 } }] }])

      await client.getUserProjects('albrodri')

      // El atajo de `per_page` alto: pedir la siguiente habría sido gastar una
      // de las 1 200 peticiones por hora para confirmar que no hay nada.
      expect(fake.calls).toHaveLength(1)
    })
  })

  describe('errores', () => {
    it('reintenta un 429 y lo consigue', async () => {
      const { client, fake } = makeClient([
        { status: 429, headers: { 'retry-after': '1' } },
        { body: [{ status: 'in_progress' }], headers: { 'x-total': '1' } },
      ])

      const page = await client.getProjectParticipantsPage(2689)

      expect(page.items).toHaveLength(1)
      expect(fake.calls).toHaveLength(2)
    })

    it('respeta el Retry-After que manda la API', async () => {
      const { client, waits } = makeClient([
        { status: 429, headers: { 'retry-after': '2' } },
        { body: [], headers: { 'x-total': '0' } },
      ])

      await client.getProjectParticipantsPage(2689)

      // La API dice cuándo puede volver: se le hace caso y no se cuenta por
      // nuestra cuenta.
      expect(waits).toEqual([2_000])
    })

    it('reintenta un 503 y al final lo declara', async () => {
      const { client, fake } = makeClient([{ status: 503, text: 'service unavailable' }])

      await expect(client.getProjectParticipantsPage(2689)).rejects.toThrow()

      // Primero + 2 reintentos: los que dice `maxRetries`.
      expect(fake.calls).toHaveLength(3)
    })

    it('no reintenta un 404, porque repetir no lo va a arreglar', async () => {
      const { client, fake } = makeClient([{ status: 404, text: '{"error":"not_found"}' }])

      await expect(client.getProjectParticipantsPage(999_999)).rejects.toThrow()

      // Una sola petición: el `services/projects.ts` distingue el 404 del resto
      // para dar un mensaje de "proyecto no encontrado" en lugar de un 502.
      expect(fake.calls).toHaveLength(1)
    })

    it('tira el token en un 401, por si estuviera caducado', async () => {
      const { client, fake, tokens } = makeClient([{ status: 401, text: '{"error":"unauthorized"}' }])

      await expect(client.getProjectParticipantsPage(2689)).rejects.toThrow()

      expect(tokens.invalidations()).toBe(1)
      // Un 401 con token de app no se arregla repitiendo con el mismo.
      expect(fake.calls).toHaveLength(1)
    })

    it('convierte un fallo de red en un error propio, sin reintentar de más', async () => {
      const { client } = makeClient([{ throws: new TypeError('fetch failed') }])

      await expect(client.getProjectParticipantsPage(2689)).rejects.toThrow()
    })

    it('propaga un timeout como timeout', async () => {
      const { client } = makeClient([{ throws: new DOMException('timeout', 'TimeoutError') }])

      await expect(client.getProjectParticipantsPage(2689)).rejects.toThrow(/timeout|Timed out/i)
    })
  })

  it('sigue funcionando con la cuota por hora casi agotada', async () => {
    // Con 3 peticiones por hora restantes, la API está a punto de cortar. Un 429
    // aquí no es un problema del cliente, así que la petición debe salir bien y
    // el servicio que llama puede mirar el aviso.
    const { client } = makeClient(
      [{ body: [], headers: { 'x-total': '0', 'x-hourly-ratelimit-remaining': '3' } }],
      { quota: { 'x-hourly-ratelimit-remaining': '3' } },
    )

    const page = await client.getProjectParticipantsPage(2689)

    expect(page.items).toEqual([])
  })

  it('avisa del fallo con el endpoint, para poder localizarlo en los logs', async () => {
    const { client } = makeClient([{ status: 500, text: 'boom' }])

    const error = await client.getProjectParticipantsPage(2689).catch((cause: unknown) => cause)

    // El endpoint va en el error: sin él, un 500 no dice ni qué llamada falló.
    expect(error).toMatchObject({
      endpoint: '/v2/projects_users',
      code: 'server_error',
      retryable: true,
    })
  })
})