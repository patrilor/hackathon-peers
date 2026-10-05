/**
 * Tests del sincronizador.
 *
 * Lo que se comprueba aquí es sobre todo el presupuesto: que no se repitan
 * llamadas que ya están frescas, que un fallo no borre lo bueno, y que un
 * checkpoint solo se marque cuando el paso terminó bien.
 */

import { describe, expect, it, vi } from 'vitest'

import { ApiError } from '../../src/api/errors.js'
import { openDatabase } from '../../src/db/database.js'
import { createServices } from '../../src/services/container.js'
import { shouldSync } from '../../src/sync/freshness.js'
import { createSynchronizer } from '../../src/sync/synchronizer.js'
import type { SyncClient } from '../../src/sync/synchronizer.js'

const START = Date.UTC(2026, 9, 4, 12, 0, 0)

/** Reloj controlable, para no dormir de verdad en los tests. */
function makeClock(start = START) {
  let current = start

  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms
    },
  }
}

/**
 * Valor de respuesta del doble.
 *
 * Acepta tres cosas:
 * - un `Error`, que se lanza (así se inyectan los fallos de la API);
 * - una función, para dar una respuesta distinta en cada llamada;
 * - un valor fijo, que se devuelve siempre igual.
 */
function reply<T>(value: T | Error | (() => T)): T {
  const resolved = typeof value === 'function' ? (value as () => T)() : value

  if (resolved instanceof Error) {
    throw resolved
  }

  return resolved
}

/**
 * Doble de la API de 42 que cuenta llamadas.
 *
 * Lo que no se sobrescriba devuelve algo razonable para que el sincronizador
 * pueda trabajar.
 */
function makeClient(overrides: Partial<Record<keyof SyncClient, unknown>> = {}) {
  const calls: string[] = []

  const pick = <T>(key: keyof SyncClient, fallback: T): T | Error | (() => T) =>
    overrides[key] === undefined ? fallback : (overrides[key] as T | Error | (() => T))

  const client: SyncClient = {
    getProjectCatalog: async () => {
      calls.push('catalog')
      return reply(pick('getProjectCatalog', [{ id: 10, name: 'ft_printf' }]))
    },
    getUserProjects: async (login: string) => {
      calls.push(`projects:${login}`)
      return reply(pick('getUserProjects', [{ status: 'in_progress', project: { id: 10 } }]))
    },
    getProjectParticipants: async (projectId: number) => {
      calls.push(`participants:${projectId}`)
      return reply(pick('getProjectParticipants', [{ id: 2, login: 'jdoe' }]))
    },
    getUser: async (login: string) => {
      calls.push(`user:${login}`)
      return reply(pick('getUser', { id: 1, login }))
    },
  }

  return { client, calls }
}

/** Base en memoria con reloj y doble de API montados. */
function makeSync(overrides: Partial<Record<keyof SyncClient, unknown>> = {}) {
  const db = openDatabase(':memory:')
  const services = createServices(db)
  const clock = makeClock()
  const { client, calls } = makeClient(overrides)
  const log = vi.fn()

  const synchronizer = createSynchronizer({
    services,
    client,
    now: clock.now,
    log,
  })

  return { synchronizer, services, clock, calls, log }
}

describe('shouldSync', () => {
  const rule = { minAgeMs: 1_000, maxStalenessMs: 10_000 }

  it('sincroniza si nunca se ha sincronizado', () => {
    expect(shouldSync(undefined, rule, 0)).toBe(true)
  })

  it('se salta si está dentro del margen de frescura', () => {
    expect(shouldSync(new Date(0), rule, 500)).toBe(false)
  })

  it('sincroniza pasado el margen de frescura', () => {
    expect(shouldSync(new Date(0), rule, 1_500)).toBe(true)
  })

  it('sincroniza siempre pasado el máximo, aunque se pida fresco', () => {
    expect(shouldSync(new Date(0), rule, 11_000)).toBe(true)
  })

  it('no se fía de un checkpoint con fecha futura', () => {
    // Copia de la base o reloj desincronizado: hay que volver a pedirlo.
    expect(shouldSync(new Date(60_000), rule, 0)).toBe(true)
  })
})

describe('sincronizador', () => {
  describe('estado global', () => {
    it('sincroniza catálogo y ubicaciones', async () => {
      const { synchronizer, calls } = makeSync()

      const results = await synchronizer.syncGlobal()

      expect(calls).toEqual(['catalog'])
      expect(results.map((r) => r.outcome)).toEqual(['updated'])
    })

    it('no vuelve a pedir lo que está fresco', async () => {
      const { synchronizer, calls, clock } = makeSync()

      await synchronizer.syncGlobal()
      clock.advance(1_000)

      const results = await synchronizer.syncGlobal()

      expect(calls).toEqual(['catalog'])
      expect(results.every((r) => r.outcome === 'skipped_fresh')).toBe(true)
    })

    it('replica el catálogo con id y nombre', async () => {
      const { synchronizer, services } = makeSync({
        getProjectCatalog: [
          { id: 10, name: 'ft_printf' },
          { id: 11, name: 'push_swap' },
        ],
      })

      await synchronizer.syncGlobal()

      expect(services.projects.nameOf(10)).toBe('ft_printf')
      expect(services.projects.nameOf(11)).toBe('push_swap')
    })

    it('NO vacía el catálogo si la API devuelve una lista vacía', async () => {
      let vacio = false
      const { synchronizer, services } = makeSync({
        // La primera vuelta rellena el catálogo; la segunda recibe una lista
        // vacía, que es lo que pasa si la 42 se degrada.
        getProjectCatalog: () => (vacio ? [] : [{ id: 10, name: 'ft_printf' }]),
      })

      await synchronizer.syncGlobal()
      expect(services.projects.nameOf(10)).toBe('ft_printf')

      // Si se aceptara el catálogo vacío, `projects` quedaría sin filas y
      // `user_projects` no podría guardar ninguna pertenencia.
      vacio = true
      services.repositories.syncState.delete('sync:projects:catalog')
      const resultado = await synchronizer.syncGlobal()

      expect(resultado[0]?.outcome).toBe('failed')
      expect(services.projects.nameOf(10)).toBe('ft_printf')
    })
  })

  describe('proyectos de una persona', () => {
    it('guarda solo lo que está en curso', async () => {
      const { synchronizer, services } = makeSync({
        getProjectCatalog: [
          { id: 10, name: 'ft_printf' },
          { id: 11, name: 'push_swap' },
        ],
        getUserProjects: [
          { status: 'in_progress', project: { id: 10 } },
          { status: 'finished', project: { id: 11 } },
        ],
      })

      await synchronizer.syncGlobal()
      await synchronizer.syncUser('albrodri')

      const enCurso = services.projects.findInProgressByUser('albrodri')
      expect(enCurso).toHaveLength(1)
      expect(enCurso[0]?.id).toBe(10)
    })

    it('salta un proyecto desconocido SIN perder los demás', async () => {
      // El 11 no está en el catálogo: es un proyecto archivado que `/projects`
      // ya no lista. Si la clave foránea revienta, se pierden también los
      // proyectos buenos de esa persona.
      const { synchronizer, services } = makeSync({
        getProjectCatalog: [{ id: 10, name: 'ft_printf' }],
        getUserProjects: [
          { status: 'in_progress', project: { id: 10 } },
          { status: 'finished', project: { id: 11 } },
        ],
      })

      await synchronizer.syncGlobal()
      await synchronizer.syncUser('albrodri')

      const enCurso = services.projects.findInProgressByUser('albrodri')
      expect(enCurso).toEqual([{ id: 10, name: 'ft_printf' }])
    })

    it('resuelve el id de la persona si aún no está replicada', async () => {
      const { synchronizer, services, calls } = makeSync({
        getUser: { id: 77, login: 'albrodri', usual_full_name: 'Alberto' },
      })

      await synchronizer.syncUser('albrodri')

      expect(calls).toContain('user:albrodri')
      expect(services.users.getByLogin('albrodri').login).toBe('albrodri')
    })

    it('no vuelve a pedir el perfil si la persona ya está replicada', async () => {
      const { synchronizer, services, calls } = makeSync()

      await synchronizer.syncGlobal() // replica a la gente del campus
      calls.length = 0
      services.repositories.users.upsertMany([{ login: 'albrodri', id: 5 }])

      await synchronizer.syncUser('albrodri')

      expect(calls).not.toContain('user:albrodri')
    })
  })

  describe('participantes de un proyecto', () => {
    it('replica a los participantes y los marca como in_progress', async () => {
      const { synchronizer, services } = makeSync({
        getProjectParticipants: [
          { id: 2, login: 'jdoe' },
          { id: 3, login: 'experto' },
        ],
      })

      await synchronizer.syncGlobal()
      await synchronizer.syncProjectParticipants(10)

      expect(services.users.exists('jdoe')).toBe(true)
      expect(services.projects.findInProgressByUser('jdoe')[0]?.id).toBe(10)
    })

    it('NO pisa un estado más fino que ya venían de projects_users', async () => {
      const { synchronizer, services } = makeSync()

      // Alguien que ya sabía que lo tenía terminado.
      services.repositories.projects.upsertCatalog([{ id: 10, name: 'ft_printf' }])
      services.repositories.users.upsertMany([{ login: 'experto', id: 3 }])
      services.repositories.projects.replaceForUser('experto', [
        { status: 'finished', project: { id: 10 } },
      ])

      // El listado del proyecto no trae estado y no debe degradar el dato.
      await synchronizer.syncProjectParticipants(10)

      const peers = services.projects.findPeers(10)
      expect(peers.find((peer) => peer.login === 'experto')?.status).toBe('finished')
    })

    it('es fresco durante un par de minutos', async () => {
      const { synchronizer, calls, clock } = makeSync()

      await synchronizer.syncProjectParticipants(10)
      clock.advance(30_000)
      await synchronizer.syncProjectParticipants(10)

      expect(calls.filter((call) => call === 'participants:10')).toHaveLength(1)
    })
  })

  describe('vuelta completa', () => {
    it('replica global, la persona y los proyectos que tiene en curso', async () => {
      const { synchronizer, calls } = makeSync({
        getProjectCatalog: [
          { id: 10, name: 'ft_printf' },
          { id: 11, name: 'push_swap' },
        ],
        getUserProjects: [
          { status: 'in_progress', project: { id: 10 } },
          { status: 'in_progress', project: { id: 11 } },
        ],
      })

      const results = await synchronizer.syncEverythingFor('albrodri')

      expect(calls).toEqual([
        'catalog',
        'projects:albrodri',
        // Todavía no está en la réplica, así que hay que pedirlo para tener su id.
        'user:albrodri',
        'participants:10',
        'participants:11',
      ])
      expect(results.every((r) => r.outcome === 'updated')).toBe(true)
    })

    it('no pide participantes si no se pudieron leer los proyectos', async () => {
      const { synchronizer, calls } = makeSync({
        getUserProjects: new ApiError('se acabó la cuota', 429),
      })

      await synchronizer.syncEverythingFor('albrodri')

      // Sin ids no hay nada que recorrer, y pedirlo sería adivinar.
      expect(calls.some((call) => call.startsWith('participants:'))).toBe(false)
    })
  })

  describe('cuando las cosas fallan', () => {
    it('un fallo deja el checkpoint viejo para reintentarlo', async () => {
      let attempts = 0
      const { synchronizer, services, clock } = makeSync({
        // Falla la primera vez y luego responde bien. Lo que se quiere ver es
        // que el checkpoint no se marca hasta que el paso termina bien.
        getProjectCatalog: () => {
          attempts += 1
          return attempts === 1 ? new ApiError('boom', 500) : [{ id: 10, name: 'ft_printf' }]
        },
      })

      const results = await synchronizer.syncGlobal()
      expect(results[0]?.outcome).toBe('failed')

      // Sin checkpoint, la siguiente vuelta lo vuelve a pedir.
      clock.advance(1_000)
      const otra = await synchronizer.syncGlobal()
      expect(otra[0]?.outcome).toBe('updated')
      expect(services.projects.nameOf(10)).toBe('ft_printf')
    })

    it('corta la vuelta con un 401 y no insiste', async () => {
      const { synchronizer, log } = makeSync({
        getProjectCatalog: new ApiError('token caducado', 401),
      })

      const results = await synchronizer.syncGlobal()

      expect(results[0]?.outcome).toBe('aborted_unauthorized')
      // Un token malo no se arregla reintentando: no tiene sentido insistir.
      expect(log).not.toHaveBeenCalled()
    })

    it('registra el fallo en el log sin filtrar nada', async () => {
      const { synchronizer, log } = makeSync({
        getProjectCatalog: new ApiError('Spam Rate Limit Exceeded', 429),
      })

      await synchronizer.syncGlobal()

      expect(log).toHaveBeenCalledTimes(1)
      expect(String(log.mock.calls[0]?.[0])).toContain('Spam Rate Limit')
    })

    it('aguanta un fallo que no es Error', async () => {
      const { synchronizer } = makeSync({ getProjectCatalog: 'nada que ver' })

      const results = await synchronizer.syncGlobal()

      expect(results[0]?.outcome).toBe('failed')
    })
  })

  describe('summarize', () => {
    it('cuenta cada resultado', async () => {
      const { synchronizer, clock } = makeSync()

      const first = await synchronizer.syncGlobal()
      clock.advance(1_000)
      const second = await synchronizer.syncGlobal()

      expect(synchronizer.summarize([...first, ...second])).toBe('updated:1 skipped_fresh:1')
    })

    it('dice "nada que hacer" con la lista vacía', () => {
      const { synchronizer } = makeSync()

      expect(synchronizer.summarize([])).toBe('nada que hacer')
    })
  })
})
