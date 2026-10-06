/**
 * Tests de los servicios: proyectos, compañeros y disponibilidad.
 *
 * Aquí se prueba la decisión de diseño que sustituye a la réplica: la lista de
 * compañeros se arma **por partes**, con un presupuesto de páginas por petición.
 * Si esto falla, la web vuelve a tardar 10 s en abrir el proyecto 2689 o, peor,
 * a caerse cuando la API de 42 responde `503`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { FortyTwoClient } from '../../src/api/client.js'
import { createThrottle } from '../../src/api/throttle.js'
import { closeDatabase, openDatabase } from '../../src/db/database.js'
import type { Db } from '../../src/db/database.js'
import { createAvailabilityRepository } from '../../src/db/repositories/availability.js'
import {
  campusDirectoryKey,
  createCacheRepository,
  peersMetaKey,
  peersPageKey,
} from '../../src/db/repositories/cache.js'
import { createAvailabilityService } from '../../src/services/availability.js'
import { createProjectsService } from '../../src/services/projects.js'
import { ApiError } from '../../src/api/errors.js'
import { createFakeFetch, createFakeSleep, stubAppTokens } from '../helpers/fake-api.js'
import { textOf } from '../helpers/rows.js'

/** Una entrada de `projects_users` con la forma que devuelve la 42 de verdad. */
function entry(
  login: string,
  options: { status?: string; location?: string | null; project?: string } = {},
) {
  return {
    status: options.status ?? 'in_progress',
    project: { id: 2689, name: options.project ?? 'Call Me Maybe' },
    user: {
      login,
      image: { link: `https://img/${login}.png`, versions: { medium: `https://img/${login}-m.png` } },
      location: options.location === undefined ? { name: 'c2r17s2' } : options.location,
      // Campos que la API manda y que no se deben cachear:
      email: `${login}@42.fr`,
      wallet: '123456',
      correction_point: 42,
    },
  }
}

/**
 * Qué logins se consideran "de Madrid" en la mayoría de los tests.
 *
 * Son los nombres que usa el resto del fichero (`entry('paciente')` etc.),
 * para que el filtro de campus no se coma a nadie de forma sorprendente. Los
 * tests que prueban el filtro de verdad pasan el suyo.
 */
const DIRECTORIO_POR_DEFECTO = new Set([
  'albrodri',
  'jdoe',
  'mgomez',
  'paciente',
  'aprobado-fuera',
  'fuera-del-centro',
  'guardia',
  'fuera',
  'nodata',
])

/** Cliente con un `fetch` que devuelve lo que se le diga, sin esperar de verdad. */
function makeClient(
  handler: (url: string) => { status?: number; body?: unknown; headers?: Record<string, string> },
) {
  const fake = createFakeFetch([], {})
  const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const spec = handler(url)
    return new Response(spec.body === undefined ? '' : JSON.stringify(spec.body), {
      status: spec.status ?? 200,
      headers: {
        'content-type': 'application/json',
        'x-hourly-ratelimit-remaining': '1197',
        'x-secondly-ratelimit-remaining': '2',
        ...spec.headers,
      },
    })
  }) as typeof fetch

  const { sleep } = createFakeSleep()

  const client = new FortyTwoClient({
    apiV2Base: 'https://api.intra.42.fr/v2',
    userAgent: 'test/1.0',
    timeoutMs: 1_000,
    pageSize: 100,
    throttle: createThrottle({ minIntervalMs: 0, sleep }),
    tokens: stubAppTokens().provider,
    fetchImpl,
    sleep,
  })

  return { client, urls: fake.urls }
}

describe('servicios', () => {
  let db: Db

  beforeEach(async () => {
    db = await openDatabase({ url: 'file::memory:' })
  })

  afterEach(() => {
    closeDatabase(db)
  })

  describe('proyectos de una persona', () => {
    it('devuelve solo los que tiene en curso, y sin duplicados', async () => {
      const { client } = makeClient(() => ({
        body: [
          entry('albrodri', { project: 'Libft' }),
          entry('albrodri', { project: 'Born2beroot', status: 'finished' }),
          entry('albrodri', { project: 'Libft' }),
        ],
      }))

      const service = createProjectsService({
        cache: createCacheRepository(db),
        availability: createAvailabilityRepository(db),
        client,
        campusId: 22,
        peersPageBudget: 5,
        peersTtlSeconds: 900,
        userProjectsTtlSeconds: 1_800,
      })

      const projects = await service.findInProgressByUser('albrodri')

      // Solo `Libft`: `Born2beroot` está terminado y `Libft` venía repetido.
      expect(projects).toEqual([{ id: 2689, name: 'Libft' }])
    })

    it('devuelve lista vacía si no tiene nada en curso, sin error', async () => {
      const { client } = makeClient(() => ({ body: [] }))

      const service = createProjectsService({
        cache: createCacheRepository(db),
        availability: createAvailabilityRepository(db),
        client,
        campusId: 22,
        peersPageBudget: 5,
        peersTtlSeconds: 900,
        userProjectsTtlSeconds: 1_800,
      })

      expect(await service.findInProgressByUser('albrodri')).toEqual([])
    })

    it('no vuelve a preguntar a la API dentro del TTL', async () => {
      let llamadas = 0
      const { client } = makeClient(() => {
        llamadas += 1
        return { body: [entry('albrodri', { project: 'Libft' })] }
      })

      const service = createProjectsService({
        cache: createCacheRepository(db),
        availability: createAvailabilityRepository(db),
        client,
        campusId: 22,
        peersPageBudget: 5,
        peersTtlSeconds: 900,
        userProjectsTtlSeconds: 1_800,
      })

      await service.findInProgressByUser('albrodri')
      await service.findInProgressByUser('albrodri')

      // Una sola llamada: recargar la web no puede costar una petición de las
      // 1 200 por hora.
      expect(llamadas).toBe(1)
    })
  })

  describe('compañeros', () => {
    function servicio(
      client: FortyTwoClient,
      overrides: {
        peersPageBudget?: number
        onUpstreamFailure?: (detail: string) => void
        /** Quiénes son de este campus. Por defecto, `DIRECTORIO_POR_DEFECTO`. */
        madrid?: ReadonlySet<string>
      } = {},
    ) {
      return createProjectsService({
        cache: createCacheRepository(db),
        availability: createAvailabilityRepository(db),
        client,
        campusId: 22,
        // El directorio va en memoria, no en la caché: aquí se prueba el filtro,
        // no la sembradura (para eso están los tests con la caché de verdad).
        loadCampusLogins: async () => overrides.madrid ?? DIRECTORIO_POR_DEFECTO,
        peersPageBudget: overrides.peersPageBudget ?? 5,
        peersTtlSeconds: 900,
        userProjectsTtlSeconds: 1_800,
        ...(overrides.onUpstreamFailure === undefined
          ? {}
          : { onUpstreamFailure: overrides.onUpstreamFailure }),
      })
    }

    it('devuelve solo los accionables y cuenta el total aparte', async () => {
      const { client } = makeClient(() => ({
        body: [
          entry('paciente', { status: 'in_progress' }),
          // Aprobado y fuera de turno: no aporta nada, no está disponible.
          entry('aprobado-fuera', { status: 'finished' }),
          // Sin puesto y sin guardia.
          entry('fuera-del-centro', { status: 'finished', location: null }),
        ],
        headers: { 'x-total': '3', 'x-per-page': '100' },
      }))

      const result = await servicio(client).findPeers(2689, 'albrodri')

      expect(result.peers.map((peer) => peer.login)).toEqual(['paciente'])
      // El total es de la API, no de lo devuelto: por eso va aparte.
      expect(result.totalParticipants).toBe(3)
    })

    it('excluye a quien pregunta', async () => {
      const { client } = makeClient(() => ({
        body: [entry('albrodri'), entry('mgomez')],
        headers: { 'x-total': '2', 'x-per-page': '100' },
      }))

      const result = await servicio(client).findPeers(2689, 'albrodri')

      expect(result.peers.map((peer) => peer.login)).toEqual(['mgomez'])
    })

    it('incluye a quien está de guardia aunque ya haya aprobado', async () => {
      const { client } = makeClient(() => ({
        body: [entry('guardia', { status: 'finished' })],
        headers: { 'x-total': '1', 'x-per-page': '100' },
      }))

      await createAvailabilityRepository(db).set('guardia', true)

      const result = await servicio(client).findPeers(2689)

      // "De guardia" gana a "aprobado": es justo el especialista que buscas.
      expect(result.peers.map((peer) => peer.login)).toEqual(['guardia'])
      expect(result.peers[0]?.available).toBe(true)
    })

    it('excluye a quien está disponible pero no tiene puesto', async () => {
      const { client } = makeClient(() => ({
        body: [entry('fuera', { status: 'finished', location: null })],
        headers: { 'x-total': '1', 'x-per-page': '100' },
      }))

      await createAvailabilityRepository(db).set('fuera', true)

      const result = await servicio(client).findPeers(2689)

      // Disponible sin puesto no se puede emparejar: la regla de guardia exige
      // las dos cosas.
      expect(result.peers).toEqual([])
    })

    it('guarda el avatar ya resuelto y nada de PII', async () => {
      const { client } = makeClient(() => ({
        body: [entry('mgomez')],
        headers: { 'x-total': '1', 'x-per-page': '100' },
      }))

      await servicio(client).findPeers(2689)

      const fila = await db.execute({
        sql: 'SELECT value FROM cache WHERE key = ?',
        args: [peersPageKey(2689, 1)],
      })
      const value = textOf(fila.rows[0], 'value')

      // Se guarda el avatar más pequeño que haya, no el original: pesa menos y
      // el front no distinguiría.
      expect(value).toContain('https://img/mgomez-m.png')
      expect(value).not.toMatch(/@42\.fr|wallet|correction_point/)
    })

    it('convierte `location` ausente en `null`, para que onDuty no se rompa', async () => {
      const { client } = makeClient(() => ({
        body: [
          {
            status: 'finished',
            project: { id: 2689, name: 'Call Me Maybe' },
            user: { login: 'nodata', image: null },
          },
        ],
        headers: { 'x-total': '1', 'x-per-page': '100' },
      }))

      await createAvailabilityRepository(db).set('nodata', true)

      const result = await servicio(client).findPeers(2689)

      expect(result.peers).toEqual([])
    })

    describe('presupuesto de páginas', () => {
      /** Projecto de 21 páginas, como el 2689. */
      function proyectoGrande() {
        const paginas = new Map<string, unknown>()

        return (url: string) => {
          const page = Number(new URL(url).searchParams.get('page') ?? '1')
          const total = 2_100
          const items = Array.from({ length: 100 }, (_, index) =>
            entry(`user-${page}-${index}`, { project: 'Call Me Maybe' }),
          )
          paginas.set(String(page), page)

          return {
            body: items,
            headers: { 'x-total': String(total), 'x-per-page': '100' },
          }
        }
      }

      /** Todos los `user-<página>-<índice>` del proyecto grande, de nuestro campus. */
      function directorioGrande(): Set<string> {
        const logins = new Set<string>()
        for (let page = 1; page <= 21; page += 1) {
          for (let index = 0; index < 100; index += 1) {
            logins.add(`user-${page}-${index}`)
          }
        }
        return logins
      }

      it('no descarga más páginas de las que permite el presupuesto', async () => {
        let pedidas = 0
        const { client } = makeClient((url) => {
          pedidas += 1
          return proyectoGrande()(url)
        })

        const result = await servicio(client, {
          peersPageBudget: 3,
          madrid: directorioGrande(),
        }).findPeers(2689)

        // La página 1 sale Establishing los metadatos, más 3 del presupuesto.
        expect(pedidas).toBe(4)
        expect(result.complete).toBe(false)
        // Y sirve lo que tiene, en vez de un error.
        expect(result.peers.length).toBeGreaterThan(0)
      })

      it('avisa de que la lista está incompleta, para que el front lo diga', async () => {
        const { client } = makeClient(proyectoGrande())

        const result = await servicio(client, {
          peersPageBudget: 2,
          madrid: directorioGrande(),
        }).findPeers(2689)

        // 2 100 participantes son 21 páginas: con 2 no está completa, y `X-Partial`
        // en la respuesta sale de aquí.
        expect(result.pages).toEqual({ cached: 3, total: 21 })
        expect(result.complete).toBe(false)
      })

      it('se completa en varias visitas sin volver a bajar lo que ya hay', async () => {
        let pedidas = 0
        const { client } = makeClient((url) => {
          pedidas += 1
          return proyectoGrande()(url)
        })

        const service = servicio(client, { peersPageBudget: 4, madrid: directorioGrande() })

        await service.findPeers(2689)
        const trasPrimera = pedidas

        await service.findPeers(2689)

        // La segunda visita solo trae las páginas que faltaban: las otras están
        // en caché y volver a pedirlas sería tirar cuota.
        expect(trasPrimera).toBe(5)
        expect(pedidas).toBe(9)
      })

      it('con presupuesto alto, la primera respuesta ya sale completa', async () => {
        const { client } = makeClient(proyectoGrande())

        const result = await servicio(client, {
          peersPageBudget: 21,
          madrid: directorioGrande(),
        }).findPeers(2689)

        expect(result.complete).toBe(true)
        expect(result.pages).toEqual({ cached: 21, total: 21 })
      })
    })

    describe('filtro por campus (solo Madrid)', () => {
      /**
       * Servicio con el directorio de la caché de verdad, como en producción:
       * sin sembrar (`npm run madrid:seed`) tiene que fallar con aviso.
       */
      function servicioConCaché(client: FortyTwoClient) {
        return createProjectsService({
          cache: createCacheRepository(db),
          availability: createAvailabilityRepository(db),
          client,
          campusId: 22,
          peersPageBudget: 5,
          peersTtlSeconds: 900,
          userProjectsTtlSeconds: 1_800,
        })
      }

      it('solo muestra y cuenta a quienes son del campus', async () => {
        const { client } = makeClient(() => ({
          body: [entry('madrilenio'), entry('foraneo')],
          headers: { 'x-total': '2', 'x-per-page': '100' },
        }))

        const result = await servicio(client, { madrid: new Set(['madrilenio']) }).findPeers(2689)

        expect(result.peers.map((peer) => peer.login)).toEqual(['madrilenio'])
        expect(result.totalParticipants).toBe(1)
      })

      it('el total de participantes cuenta el campus, no el X-Total global de la 42', async () => {
        const { client } = makeClient(() => ({
          body: [entry('madrilenio'), entry('foraneo', { status: 'finished' })],
          headers: { 'x-total': '99', 'x-per-page': '100' },
        }))

        const result = await servicio(client, { madrid: new Set(['madrilenio']) }).findPeers(2689)

        // La API dice 99 participantes, pero solo es de aquí quien está en el
        // directorio: el número no puede mentir sobre quién está en el campus.
        expect(result.totalParticipants).toBe(1)
      })

      it('una página entera de foráneos no cuenta como participantes', async () => {
        const { client } = makeClient(() => ({
          body: [entry('foraneo-1'), entry('foraneo-2')],
          headers: { 'x-total': '2', 'x-per-page': '100' },
        }))

        const result = await servicio(client, { madrid: new Set([]) }).findPeers(2689)

        expect(result.peers).toEqual([])
        expect(result.totalParticipants).toBe(0)
      })

      it('falla con aviso si el directorio no está sembrado', async () => {
        const { client } = makeClient(() => ({ body: [] }))

        // Sin `campus_directory:22` no hay manera de saber quién es de aquí, y
        // no filtrar colaría a gente de otros campus: mejor 500 con aviso.
        await expect(servicioConCaché(client).findPeers(2689)).rejects.toThrow(/madrid:seed/)
      })

      it('sigue filtrando con un directorio caducado', async () => {
        // TTL negativo: caducó. El `get` lo da por perdido, pero el servicio
        // cae a `getStale` porque un directorio de hace unas horas filtra
        // mejor que ninguno.
        await createCacheRepository(db).set(campusDirectoryKey(22), ['madrilenio'], -1)

        const { client } = makeClient(() => ({
          body: [entry('madrilenio'), entry('foraneo')],
          headers: { 'x-total': '2', 'x-per-page': '100' },
        }))

        const result = await servicioConCaché(client).findPeers(2689)

        expect(result.peers.map((peer) => peer.login)).toEqual(['madrilenio'])
        expect(result.totalParticipants).toBe(1)
      })

      it('una página cacheada antes del filtro no cuela a foráneos al leerla', async () => {
        const cache = createCacheRepository(db)
        await cache.set(campusDirectoryKey(22), ['madrilenio'], 900)
        // Página "vieja", guardada cuando no había filtro: trae a un foráneo.
        await cache.set(
          peersMetaKey(2689),
          { total: 2, perPage: 100, pages: 1, name: 'Call Me Maybe' },
          900,
        )
        await cache.set(
          peersPageKey(2689, 1),
          [
            { login: 'foraneo', image: null, location: null, status: 'in_progress' },
            { login: 'madrilenio', image: null, location: null, status: 'in_progress' },
          ],
          900,
        )

        const { client } = makeClient(() => ({ body: [] }))
        const result = await servicioConCaché(client).findPeers(2689)

        // Cinto y tirantes: aunque la fila estuviera ahí, al leerla se vuelve a
        // filtrar y el foráneo no aparece.
        expect(result.peers.map((peer) => peer.login)).toEqual(['madrilenio'])
        expect(result.totalParticipants).toBe(1)
      })
    })

    describe('fallos de la API de 42', () => {
      it('sigue sirviendo la caché cuando la 42 falla', async () => {
        let llamadas = 0
        const { client } = makeClient(() => {
          llamadas += 1
          // La primera va bien; las siguientes fallan, como cuando 42 da un 503.
          if (llamadas === 1) {
            return { body: [entry('mgomez')], headers: { 'x-total': '1', 'x-per-page': '100' } }
          }
          return { status: 503, body: { error: 'service unavailable' } }
        })

        const avisos: string[] = []
        const service = servicio(client, { peersPageBudget: 5, onUpstreamFailure: (d) => avisos.push(d) })

        await service.findPeers(2689)

        await db.execute({
          sql: 'UPDATE cache SET expires_at = ? WHERE key = ?',
          args: ['2000-01-01T00:00:00.000Z', peersPageKey(2689, 1)],
        })

        const result = await service.findPeers(2689)

        // Nadie se queda sin lista porque 42 esté caída: sale lo que había.
        expect(result.peers.map((peer) => peer.login)).toEqual(['mgomez'])
        expect(avisos.length).toBeGreaterThan(0)
      })

      it('devuelve 404 si el proyecto no existe', async () => {
        const { client } = makeClient(() => ({ status: 404, body: { error: 'not_found' } }))

        await expect(servicio(client).findPeers(999_999)).rejects.toMatchObject({
          code: 'not_found',
        })
      })

      it('no se lía con un id de proyecto que no es un número', async () => {
        const { client } = makeClient(() => ({ body: [] }))

        // `NaN` en la URL de la 42 sería un fallo propio disfrazado de otro cosa.
        await expect(servicio(client).findPeers(Number.NaN)).rejects.toMatchObject({
          code: 'invalid_input',
        })
        await expect(servicio(client).findPeers(-1)).rejects.toMatchObject({
          code: 'invalid_input',
        })
      })

      it('sigue funcionando si la API devuelve algo que no es una lista', async () => {
        const { client } = makeClient(() => ({ body: { error: 'algo raro' } }))

        await expect(servicio(client).findPeers(2689)).rejects.toThrow(/no ha devuelto una lista/)
      })

      it('devuelve 502 si la 42 falla y no hay nada cacheado, ni viejo', async () => {
        const { client } = makeClient(() => ({ status: 503, body: { error: 'unavailable' } }))

        const avisos: string[] = []
        const service = servicio(client, { onUpstreamFailure: (d) => avisos.push(d) })

        // Sin caché no hay nada que inventar: un 502 claro es mejor que una lista
        // vacía que parece que el proyecto no tiene gente.
        await expect(service.findPeers(2689)).rejects.toThrow()
        expect(avisos.length).toBeGreaterThan(0)
      })
    })

    it('recorta las entradas sin persona en vez de fallar', async () => {
      const { client } = makeClient(() => ({
        body: [entry('mgomez'), { status: 'in_progress', project: { id: 2689 }, user: null }],
        headers: { 'x-total': '2', 'x-per-page': '100' },
      }))

      const result = await servicio(client).findPeers(2689)

      expect(result.peers.map((peer) => peer.login)).toEqual(['mgomez'])
    })

    it('recuerda el nombre del proyecto', async () => {
      const { client } = makeClient(() => ({
        body: [entry('mgomez', { project: 'Call Me Maybe' })],
        headers: { 'x-total': '1', 'x-per-page': '100' },
      }))

      const service = servicio(client)
      await service.findPeers(2689)

      expect(await service.nameOf(2689)).toBe('Call Me Maybe')
    })

    it('no dice el nombre de un proyecto que no ha mirado', async () => {
      const { client } = makeClient(() => ({ body: [] }))

      expect(await servicio(client).nameOf(1234)).toBeNull()
    })
  })

  describe('disponibilidad', () => {
    const service = () => createAvailabilityService(createAvailabilityRepository(db))

    it('guarda y devuelve lo que se le marca', async () => {
      expect(await service().set('albrodri', true)).toEqual({ available: true })
      expect(await service().get('albrodri')).toEqual({ available: true })

      expect(await service().set('albrodri', false)).toEqual({ available: false })
      expect(await service().get('albrodri')).toEqual({ available: false })
    })

    it('devuelve false para alguien que no ha marcado nada', async () => {
      expect(await service().get('nuevo')).toEqual({ available: false })
    })

    it('rechaza un `available` que no es booleano', async () => {
      // `"true"` en texto: el front manda booleano, y si llega otra cosa es un
      // error de cliente, no algo que se guarde como disponible.
      await expect(service().set('albrodri', 'true')).rejects.toMatchObject({
        code: 'invalid_input',
      })
      await expect(service().set('albrodri', 1)).rejects.toMatchObject({
        code: 'invalid_input',
      })
      await expect(service().set('albrodri', null)).rejects.toMatchObject({
        code: 'invalid_input',
      })
    })

    it('dice cuándo se marcó por última vez', async () => {
      await service().set('albrodri', true)

      expect(await service().updatedAt('albrodri')).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })
  })

  it('describe bien un error de la API para el log', () => {
    // El `describe` de `projects.ts` acaba en los logs cuando la 42 falla: si
    // saliera `[object Object]`, no serviría de nada.
    const error = new ApiError('La API de 42 respondió 503 a /v2/projects_users', 503)

    expect(error.message).toContain('/v2/projects_users')
  })
})