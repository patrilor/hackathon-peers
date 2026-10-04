/**
 * Tests de los servicios de dominio.
 *
 * Se montan sobre una base SQLite real en memoria, no sobre mocks: los
 * servicios son finos, pero lo que falla de verdad (claves foráneas, tipos,
 * SQL mal escrito) solo aparece contra la base real.
 */

import { describe, expect, it } from 'vitest'

import { openDatabase } from '../../src/db/database.js'
import { DomainError } from '../../src/domain/errors.js'
import type { ApiProjectUser } from '../../src/domain/types.js'
import { createServices } from '../../src/services/container.js'

const CAMPUS_ID = 22

/**
 * Monta una base limpia con los servicios encima.
 *
 * Cada test recibe la suya: `makeServices()` dos veces daría dos bases
 * distintas y lo que se escribiera en una no se vería en la otra.
 */
function makeServices() {
  const db = openDatabase(':memory:')
  return { ...createServices(db, CAMPUS_ID) }
}

/** Persona replicada. Sin esto, las claves foráneas bloquean el resto. */
function seedUser(
  services: ReturnType<typeof makeServices>,
  login: string,
  id: number,
  imageUrl?: string | null,
) {
  // `exactOptionalPropertyTypes`: si no hay foto, la clave no se manda, en vez
  // de mandar `undefined`.
  services.repositories.users.upsertMany([
    imageUrl === undefined ? { login, id } : { login, id, imageUrl },
  ])
}

/**
 * Registra a una persona con sus proyectos.
 *
 * El orden importa: `user_projects` tiene claves foráneas contra `users` y
 * contra `projects`, así que el catálogo tiene que existir antes de meter
 * anyone's pertenencias.
 */
function seedUserWithProjects(
  services: ReturnType<typeof makeServices>,
  login: string,
  id: number,
  memberships: readonly ApiProjectUser[],
) {
  seedUser(services, login, id)
  for (const entry of memberships) {
    const projectId = entry.project?.id
    if (projectId !== undefined) {
      services.repositories.projects.upsertCatalog([{ id: projectId, name: `p${projectId}` }])
    }
  }
  services.repositories.projects.replaceForUser(login, memberships)
}

/** Entrada de `projects_users` con la forma que espera el repositorio. */
function membership(projectId: number, status: string): ApiProjectUser {
  return { status, project: { id: projectId, name: `p${projectId}` } }
}

describe('servicios de dominio', () => {
  describe('users', () => {
    it('devuelve login e image de la persona', () => {
      const services = makeServices()
      seedUser(services, 'albrodri', 1, 'https://img/1.png')

      expect(services.users.getByLogin('albrodri')).toEqual({
        login: 'albrodri',
        image: 'https://img/1.png',
      })
    })

    it('devuelve image null cuando no hay foto', () => {
      const services = makeServices()
      seedUser(services, 'albrodri', 1)

      expect(services.users.getByLogin('albrodri')).toEqual({ login: 'albrodri', image: null })
    })

    it('lanza not_found si la persona no está replicada', () => {
      const services = makeServices()

      expect(() => services.users.getByLogin('fantasma')).toThrow(DomainError)
      expect.assertions(2)
      try {
        services.users.getByLogin('fantasma')
      } catch (error) {
        expect((error as DomainError).code).toBe('not_found')
      }
    })

    it('exists() responde sin lanzar', () => {
      const services = makeServices()
      seedUser(services, 'albrodri', 1)

      expect(services.users.exists('albrodri')).toBe(true)
      expect(services.users.exists('fantasma')).toBe(false)
    })
  })

  describe('projects', () => {
    it('lista solo los proyectos en curso de una persona', () => {
      const services = makeServices()
      seedUserWithProjects(services, 'albrodri', 1, [
        membership(10, 'in_progress'),
        membership(11, 'finished'),
      ])

      // Los terminados no se ofrecen como "mis proyectos en curso".
      expect(services.projects.findInProgressByUser('albrodri')).toHaveLength(1)
      expect(services.projects.findInProgressByUser('albrodri')[0]?.id).toBe(10)
    })

    it('devuelve lista vacía si no hay datos, sin lanzar', () => {
      const services = makeServices()

      expect(services.projects.findInProgressByUser('albrodri')).toEqual([])
    })

    it('rechaza un id que no es un entero positivo', () => {
      const services = makeServices()

      for (const id of [0, -1, 1.5, Number.NaN]) {
        expect(() => services.projects.findPeers(id)).toThrow(DomainError)
      }
    })

    it('lanza not_found si el proyecto no está en el catálogo', () => {
      const services = makeServices()

      expect(() => services.projects.findPeers(999)).toThrow(DomainError)
      try {
        services.projects.findPeers(999)
      } catch (error) {
        expect((error as DomainError).code).toBe('not_found')
      }
    })

    it('devuelve compañeros con su estado y disponibilidad', () => {
      const services = makeServices()
      seedUserWithProjects(services, 'albrodri', 1, [membership(10, 'in_progress')])
      seedUserWithProjects(services, 'experto', 2, [membership(10, 'finished')])
      services.availability.set('albrodri', true)

      const peers = services.projects.findPeers(10)

      expect(peers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ login: 'albrodri', status: 'in_progress', available: true }),
          expect.objectContaining({ login: 'experto', status: 'finished' }),
        ]),
      )
    })

    it('excluye a la persona que consulta entre sus compañeros', () => {
      const services = makeServices()
      seedUserWithProjects(services, 'albrodri', 1, [membership(10, 'in_progress')])
      seedUserWithProjects(services, 'jdoe', 2, [membership(10, 'in_progress')])
      seedUserWithProjects(services, 'otro', 3, [membership(10, 'in_progress')])

      const todos = services.projects
        .findPeers(10)
        .map((peer) => peer.login)
        .sort()

      expect(todos).toContain('albrodri')

      const sinYo = services.projects
        .findPeers(10, 'albrodri')
        .map((peer) => peer.login)

      expect(sinYo).toContain('jdoe')
      expect(sinYo).toContain('otro')
      expect(sinYo).not.toContain('albrodri')
    })

    it('nameOf() devuelve undefined si no conoce el proyecto', () => {
      const services = makeServices()
      services.repositories.projects.upsertCatalog([{ id: 10, name: 'ft_printf' }])

      expect(services.projects.nameOf(10)).toBe('ft_printf')
      expect(services.projects.nameOf(999)).toBeUndefined()
    })
  })

  describe('availability', () => {
    it('guarda y devuelve la disponibilidad', () => {
      const services = makeServices()
      seedUser(services, 'albrodri', 1)

      expect(services.availability.set('albrodri', true)).toEqual({ available: true })
      expect(services.availability.get('albrodri')).toEqual({ available: true })
    })

    it('permite pasar de true a false', () => {
      const services = makeServices()
      seedUser(services, 'albrodri', 1)

      services.availability.set('albrodri', true)
      expect(services.availability.set('albrodri', false)).toEqual({ available: false })
      expect(services.availability.get('albrodri')).toEqual({ available: false })
    })

    it('rechaza un valor que no es booleano', () => {
      const services = makeServices()
      seedUser(services, 'albrodri', 1)

      for (const valor of ['true', 1, 0, null, undefined, {}]) {
        expect(() => services.availability.set('albrodri', valor)).toThrow(DomainError)
      }
    })

    it('lanza not_found si la persona no está replicada', () => {
      const services = makeServices()

      expect(() => services.availability.set('fantasma', true)).toThrow(DomainError)
      try {
        services.availability.set('fantasma', true)
      } catch (error) {
        expect((error as DomainError).code).toBe('not_found')
      }
    })

    it('devuelve false en vez de fallar si nunca se ha marcado', () => {
      const services = makeServices()
      seedUser(services, 'albrodri', 1)

      // Acaba de entrar y no ha tocado el toggle: "no disponible", no un error.
      expect(services.availability.get('albrodri')).toEqual({ available: false })
    })

    it('updatedAt() es undefined hasta la primera marca', () => {
      const services = makeServices()
      seedUser(services, 'albrodri', 1)

      expect(services.availability.updatedAt('albrodri')).toBeUndefined()
      services.availability.set('albrodri', true)
      expect(typeof services.availability.updatedAt('albrodri')).toBe('string')
    })
  })
})