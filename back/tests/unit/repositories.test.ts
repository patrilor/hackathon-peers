/**
 * Tests de los repositorios: `availability` y `cache`.
 *
 * Los dos van contra una base SQLite real en memoria, no contra un mock. Con
 * `@libsql/client` las consultas son `async`, y un mock que devolviera lo que
 * espera el código no probaría nada: el error interesante en una consulta está
 * en el SQL, no en el `await`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { closeDatabase, openDatabase } from '../../src/db/database.js'
import type { Db } from '../../src/db/database.js'
import { createAvailabilityRepository } from '../../src/db/repositories/availability.js'
import {
  createCacheRepository,
  peersMetaKey,
  peersPageKey,
  peersPrefix,
  userProjectsKey,
} from '../../src/db/repositories/cache.js'
import { textOf } from '../helpers/rows.js'

describe('repositorios', () => {
  let db: Db

  beforeEach(async () => {
    db = await openDatabase({ url: 'file::memory:' })
  })

  afterEach(() => {
    closeDatabase(db)
  })

  describe('availability', () => {
    it('devuelve false para alguien que nunca ha marcado su disponibilidad', async () => {
      const repo = createAvailabilityRepository(db)

      expect(await repo.get('nuevo')).toBe(false)
      expect(await repo.getUpdatedAt('nuevo')).toBeUndefined()
    })

    it('guarda y devuelve true', async () => {
      const repo = createAvailabilityRepository(db)

      expect(await repo.set('albrodri', true)).toBe(true)
      expect(await repo.get('albrodri')).toBe(true)
    })

    it('guarda y devuelve false explícito, en vez de dejar un undefined', async () => {
      const repo = createAvailabilityRepository(db)

      await repo.set('albrodri', true)
      expect(await repo.set('albrodri', false)).toBe(false)
      // La fila sigue existiendo: se puede volver a poner a true y se recuerda
      // cuándo se tocó por última vez.
      expect(await repo.get('albrodri')).toBe(false)
      expect(await repo.getUpdatedAt('albrodri')).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })

    it('sobrescribe en vez de duplicar al marcar dos veces', async () => {
      const repo = createAvailabilityRepository(db)

      await repo.set('albrodri', true)
      await repo.set('albrodri', false)
      await repo.set('albrodri', true)

      const rows = await repo.listAll()
      expect(rows).toHaveLength(1)
      expect(Number(rows[0]?.available)).toBe(1)
    })

    it('devuelve todos los logins indexados en un mapa', async () => {
      const repo = createAvailabilityRepository(db)

      await repo.set('albrodri', true)
      await repo.set('mgomez', false)
      await repo.set('jdoe', true)

      const map = await repo.mapOfAll()

      expect(map.get('albrodri')).toBe(true)
      expect(map.get('jdoe')).toBe(true)
      // Guardado como false explícito, y en el mapa como false.
      expect(map.get('mgomez')).toBe(false)
      expect(map.size).toBe(3)
    })

    it('deja fuera a quien no ha marcado nada', async () => {
      const repo = createAvailabilityRepository(db)

      await repo.set('albrodri', true)

      expect((await repo.mapOfAll()).has('jdoe')).toBe(false)
    })
  })

  describe('cache', () => {
    it('devuelve undefined si no está la clave', async () => {
      const cache = createCacheRepository(db)

      expect(await cache.get('nada')).toBeUndefined()
    })

    it('guarda y recupera un objeto', async () => {
      const cache = createCacheRepository(db)
      const valor = { total: 2047, per_page: 100, pages: 21 }

      await cache.set(peersMetaKey(2689), valor, 900)

      expect(await cache.get(peersMetaKey(2689))).toEqual(valor)
    })

    it('sobrescribe la misma clave en vez de duplicarla', async () => {
      const cache = createCacheRepository(db)

      await cache.set(peersPageKey(2689, 1), [{ login: 'a' }], 900)
      await cache.set(peersPageKey(2689, 1), [{ login: 'b' }], 900)

      expect(await cache.get(peersPageKey(2689, 1))).toEqual([{ login: 'b' }])
      expect(await cache.count()).toBe(1)
    })

    it('trata una fila caducada como si no existiera', async () => {
      const cache = createCacheRepository(db)

      // Caduca en el pasado: ni siquiera hay que esperar a que pase el tiempo.
      await cache.set('peers:2689:meta', { total: 1 }, -1)

      expect(await cache.get('peers:2689:meta')).toBeUndefined()
    })

    it('purga lo caducado y conserva lo que sigue vivo', async () => {
      const cache = createCacheRepository(db)

      await cache.set('peers:2689:p1', [{ login: 'viejo' }], -1)
      await cache.set('peers:2689:p2', [{ login: 'nuevo' }], 900)

      expect(await cache.purgeExpired()).toBe(1)
      expect(await cache.get('peers:2689:p1')).toBeUndefined()
      expect(await cache.get('peers:2689:p2')).toEqual([{ login: 'nuevo' }])
    })

    it('borra una clave concreta', async () => {
      const cache = createCacheRepository(db)

      await cache.set('user_projects:albrodri', [{ id: 1, name: 'p' }], 900)
      await cache.drop(userProjectsKey('albrodri'))

      expect(await cache.get(userProjectsKey('albrodri'))).toBeUndefined()
    })

    it('borra todas las claves de un prefijo sin tocar las de otro proyecto', async () => {
      const cache = createCacheRepository(db)

      await cache.set(peersMetaKey(2689), { total: 2047 }, 900)
      await cache.set(peersPageKey(2689, 1), [{ login: 'a' }], 900)
      await cache.set(peersPageKey(2689, 2), [{ login: 'b' }], 900)
      await cache.set(peersMetaKey(2705), { total: 12 }, 900)

      expect(await cache.countWithPrefix(peersPrefix(2689))).toBe(3)

      await cache.dropPrefix(peersPrefix(2689))

      expect(await cache.countWithPrefix(peersPrefix(2689))).toBe(0)
      // El otro proyecto sigue ahí: invalidar uno no puede tumbar el otro.
      expect(await cache.get(peersMetaKey(2705))).toEqual({ total: 12 })
    })

    it('lee lo caducado con getStale, para cuando la 42 está caída', async () => {
      const cache = createCacheRepository(db)

      await cache.set('peers:2689:p1', [{ login: 'viejo' }], -1)

      // `get` lo da por perdido; `getStale` lo saca, porque un compañero de hace
      // media hora sigue sirviendo de pista.
      expect(await cache.get('peers:2689:p1')).toBeUndefined()
      expect(await cache.getStale('peers:2689:p1')).toEqual([{ login: 'viejo' }])
    })

    it('getStale también lee lo que está vivo', async () => {
      const cache = createCacheRepository(db)

      await cache.set('peers:2689:p1', [{ login: 'fresco' }], 900)

      expect(await cache.getStale('peers:2689:p1')).toEqual([{ login: 'fresco' }])
    })

    it('getStale devuelve undefined si no está', async () => {
      expect(await createCacheRepository(db).getStale('nada')).toBeUndefined()
    })

    it('no se rompe con un JSON corrupto en vez de tumbar la petición', async () => {
      const cache = createCacheRepository(db)

      await db.execute({
        sql: `INSERT INTO cache (key, value, expires_at, updated_at)
              VALUES ('rota', 'esto no es json', '2999-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      })

      expect(await cache.get('rota')).toBeUndefined()
    })

    it('no guarda PII: solo lo que el front necesita', async () => {
      const cache = createCacheRepository(db)

      await cache.set(
        peersPageKey(2689, 1),
        [{ login: 'albrodri', image: null, location: 'c2r17s2', status: 'in_progress', available: false }],
        900,
      )

      const fila = await db.execute({
        sql: 'SELECT value FROM cache WHERE key = ?',
        args: [peersPageKey(2689, 1)],
      })
      const value = textOf(fila.rows[0], 'value')
      const guardados = JSON.parse(value) as Record<string, unknown>[]

      expect(Object.keys(guardados[0] ?? {})).toEqual([
        'login',
        'image',
        'location',
        'status',
        'available',
      ])
      expect(value).not.toMatch(/@42|wallet|correction_point/)
    })
  })

  describe('claves de la caché', () => {
    it('son estables y distinguen proyectos y páginas', () => {
      expect(userProjectsKey('albrodri')).toBe('user_projects:albrodri')
      expect(peersMetaKey(2689)).toBe('peers:2689:meta')
      expect(peersPageKey(2689, 21)).toBe('peers:2689:p21')
      // El prefijo de un proyecto incluye los dos puntos del final para no
      // confundirse con el prefijo de otro que empiece igual (`:p1` vs `:p12`).
      expect(peersPrefix(2689)).toBe('peers:2689:')
    })
  })
})