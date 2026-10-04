/**
 * Tests de los repositorios.
 *
 * Aquí se prueba la lógica que hace que Sanatorio sirva para algo: cruzar
 * proyectos, ubicaciones y disponibilidad. Si esto falla, la web muestra
 * peers equivocados, y no hay forma de que alguien se entere.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { openDatabase, type Db } from '../../src/db/database.js'
import { createUsersRepository } from '../../src/db/repositories/users.js'
import { createLocationsRepository } from '../../src/db/repositories/locations.js'
import { createProjectsRepository, normalizeStatus } from '../../src/db/repositories/projects.js'
import { createAvailabilityRepository } from '../../src/db/repositories/availability.js'
import { createSyncStateRepository, SYNC_KEYS } from '../../src/db/repositories/sync-state.js'
import type { ApiCampusLocation } from '../../src/domain/types.js'

const CAMPUS = 22
const PISCINA = 2609 // "Piscina", el proyecto que usan los ejemplos de la API
const LIBFT = 1337

let db: Db
let users: ReturnType<typeof createUsersRepository>
let locations: ReturnType<typeof createLocationsRepository>
let projects: ReturnType<typeof createProjectsRepository>
let availability: ReturnType<typeof createAvailabilityRepository>
let syncState: ReturnType<typeof createSyncStateRepository>

/** Entrada de campus con los campos mínimos que usa el repositorio. */
function campusEntry(
  login: string,
  id: number,
  host: string | null,
  primary = true,
): ApiCampusLocation {
  return { host, primary, campus_id: CAMPUS, user: { id, login, kind: 'student' } }
}

beforeEach(() => {
  db = openDatabase(':memory:')
  users = createUsersRepository(db)
  locations = createLocationsRepository(db)
  projects = createProjectsRepository(db)
  availability = createAvailabilityRepository(db)
  syncState = createSyncStateRepository(db)

  projects.upsertCatalog([
    { id: PISCINA, name: 'Piscina', slug: 'piscina' },
    { id: LIBFT, name: 'Libft', slug: 'libft' },
  ])
})

describe('normalizeStatus', () => {
  it('acepta los dos estados que nos interesan', () => {
    expect(normalizeStatus('in_progress')).toBe('in_progress')
    expect(normalizeStatus('finished')).toBe('finished')
  })

  it('descarta el resto de estados de la API', () => {
    // Si estos se colaran, el front recibiría un status que no sabe pintar.
    for (const status of [
      'waiting_to_be_started',
      'upcoming',
      'started',
      'trashed',
      'lo_que_sea',
    ]) {
      expect(normalizeStatus(status)).toBeNull()
    }
  })
})

describe('repositorio de personas', () => {
  it('inserta y recupera por login', () => {
    users.upsertMany([{ login: 'albrodri', id: 42, imageUrl: 'https://cdn/42/albrodri.jpg' }])

    const user = users.findByLogin('albrodri')
    expect(user?.user_id).toBe(42)
    expect(user?.image_url).toBe('https://cdn/42/albrodri.jpg')
  })

  it('recupera por id numérico, que es lo que exigen algunas rutas de 42', () => {
    users.upsertMany([{ login: 'plopez-l', id: 7 }])

    expect(users.findById(7)?.login).toBe('plopez-l')
  })

  it('actualiza sin duplicar cuando llega el mismo login otra vez', () => {
    users.upsertMany([{ login: 'albrodri', id: 42, imageUrl: 'https://cdn/viejo.jpg' }])
    users.upsertMany([{ login: 'albrodri', id: 42, imageUrl: 'https://cdn/nuevo.jpg' }])

    expect(users.count()).toBe(1)
    expect(users.findByLogin('albrodri')?.image_url).toBe('https://cdn/nuevo.jpg')
  })

  it('guarda image null cuando la API no trae imagen', () => {
    users.upsertMany([{ login: 'sinfoto', id: 9, imageUrl: null }])

    // Nunca debe quedar "undefined": el front espera string o null.
    expect(users.findByLogin('sinfoto')?.image_url).toBeNull()
  })

  it('acepta un lote vacío sin tocar nada', () => {
    expect(() => {
      users.upsertMany([])
    }).not.toThrow()
    expect(users.count()).toBe(0)
  })
})

describe('repositorio de ubicaciones', () => {
  beforeEach(() => {
    users.upsertMany([
      { login: 'albrodri', id: 1 },
      { login: 'plopez-l', id: 2 },
    ])
  })

  it('guarda el puesto en el cluster de cada persona', () => {
    locations.replaceSnapshot(CAMPUS, [campusEntry('albrodri', 1, 'c2r17s2')])

    expect(locations.findByLogin('albrodri', CAMPUS)?.host).toBe('c2r17s2')
    expect(locations.countByCampus(CAMPUS)).toBe(1)
  })

  it('hace desaparecer a quien se va del campus al siguiente snapshot', () => {
    locations.replaceSnapshot(CAMPUS, [campusEntry('albrodri', 1, 'c2r17s2')])
    locations.replaceSnapshot(CAMPUS, [campusEntry('plopez-l', 2, 'c2r20s1')])

    // El snapshot sustituye, no acumula: quien se fue ya no está.
    expect(locations.findByLogin('albrodri', CAMPUS)).toBeUndefined()
    expect(locations.countByCampus(CAMPUS)).toBe(1)
  })

  it('ignora entradas sin puesto, porque no sirven de nada', () => {
    locations.replaceSnapshot(CAMPUS, [campusEntry('albrodri', 1, null)])

    expect(locations.countByCampus(CAMPUS)).toBe(0)
  })

  it('conserva la disponibilidad de quien se va del campus', () => {
    availability.set('albrodri', true)
    locations.replaceSnapshot(CAMPUS, [campusEntry('albrodri', 1, 'c2r17s2')])
    locations.replaceSnapshot(CAMPUS, [])

    // La disponibilidad es un dato nuestro y no se borra al salir del campus.
    // Lo que decide si está "de guardia" es la combinación de los dos campos.
    expect(availability.get('albrodri')).toBe(true)
  })
})

describe('repositorio de disponibilidad', () => {
  beforeEach(() => {
    // La disponibilidad tiene clave foránea contra `users`: solo se puede marcar
    // la de alguien que ya conocemos, que es justo lo que pasa tras el login.
    users.upsertMany([
      { login: 'albrodri', id: 1 },
      { login: 'nuevo', id: 2 },
    ])
  })

  it('devuelve false si nadie ha marcado nada todavía', () => {
    // Nunca undefined: el front trata `available` como booleano.
    expect(availability.get('nuevo')).toBe(false)
  })

  it('guarda y recupera el valor', () => {
    availability.set('albrodri', true)
    expect(availability.get('albrodri')).toBe(true)

    availability.set('albrodri', false)
    expect(availability.get('albrodri')).toBe(false)
  })

  it('crea fila explícita incluso al guardar false', () => {
    availability.set('albrodri', false)

    expect(availability.getUpdatedAt('albrodri')).toBeDefined()
    expect(availability.listAll()).toHaveLength(1)
  })

  it('rechaza marcar la disponibilidad de alguien que no conocemos', () => {
    // La clave foránea lo impide. Preferimos esto a guardar filas de availability
    // huérfanas que luego el endpoint de peers no sabría interpretar.
    expect(() => availability.set('fantasma', true)).toThrow(/FOREIGN KEY/i)
  })
})

describe('repositorio de proyectos y peers', () => {
  beforeEach(() => {
    // albrodri: tiene Piscina en curso, está en el campus y de guardia.
    // plopez-l: tiene Piscina en curso, pero está fuera del campus.
    // legomez: aprobó Piscina, está en el campus pero fuera de turno.
    // outsider: tiene Piscina en curso pero no sabemos dónde está.
    users.upsertMany([
      { login: 'albrodri', id: 1, imageUrl: 'https://cdn/a.jpg' },
      { login: 'plopez-l', id: 2 },
      { login: 'legomez', id: 3 },
      { login: 'outsider', id: 4 },
    ])

    projects.replaceForUser('albrodri', [
      { status: 'in_progress', project: { id: PISCINA, name: 'Piscina' } },
    ])
    projects.replaceForUser('plopez-l', [
      { status: 'in_progress', project: { id: PISCINA, name: 'Piscina' } },
    ])
    projects.replaceForUser('legomez', [
      { status: 'finished', project: { id: PISCINA, name: 'Piscina' } },
    ])
    projects.replaceForUser('outsider', [
      { status: 'in_progress', project: { id: PISCINA, name: 'Piscina' } },
    ])

    locations.replaceSnapshot(CAMPUS, [
      campusEntry('albrodri', 1, 'c2r17s2'),
      campusEntry('legomez', 3, 'c2r20s1'),
    ])

    availability.set('albrodri', true)
  })

  it('devuelve los proyectos en curso de una persona, no los aprobados', () => {
    projects.replaceForUser('albrodri', [
      { status: 'in_progress', project: { id: PISCINA, name: 'Piscina' } },
      { status: 'finished', project: { id: LIBFT, name: 'Libft' } },
    ])

    // /me/projects pregunta "en qué estoy ahora", no "qué he aprobado nunca".
    expect(projects.findInProgressByUser('albrodri')).toEqual([{ id: PISCINA, name: 'Piscina' }])
  })

  it('trae a los participantes del proyecto con los cuatro campos del contrato', () => {
    const peers = projects.findPeers(PISCINA, CAMPUS)

    expect(peers.map((peer) => peer.login).sort()).toEqual([
      'albrodri',
      'legomez',
      'outsider',
      'plopez-l',
    ])

    for (const peer of peers) {
      expect(Object.keys(peer).sort()).toEqual([
        'available',
        'image',
        'location',
        'login',
        'status',
      ])
      expect(typeof peer.available).toBe('boolean')
    }
  })

  it('distingue a quien está en el campus de quien no', () => {
    const peers = projects.findPeers(PISCINA, CAMPUS)
    const byLogin = new Map(peers.map((peer) => [peer.login, peer]))

    expect(byLogin.get('albrodri')?.location).toBe('c2r17s2')
    expect(byLogin.get('plopez-l')?.location).toBeNull()
    expect(byLogin.get('outsider')?.location).toBeNull()
  })

  it('marca como especialista a quien ya aprobó el proyecto', () => {
    const peers = projects.findPeers(PISCINA, CAMPUS)
    const byLogin = new Map(peers.map((peer) => [peer.login, peer]))

    expect(byLogin.get('albrodri')?.status).toBe('in_progress')
    expect(byLogin.get('legomez')?.status).toBe('finished')
  })

  it('deja available en false a quien no ha marcado disponibilidad', () => {
    const peers = projects.findPeers(PISCINA, CAMPUS)
    const byLogin = new Map(peers.map((peer) => [peer.login, peer]))

    // legomez está en el campus pero fuera de turno: available false, no undefined.
    expect(byLogin.get('legomez')).toMatchObject({ location: 'c2r20s1', available: false })
    expect(byLogin.get('outsider')?.available).toBe(false)
    expect(byLogin.get('albrodri')?.available).toBe(true)
  })

  it('solo devuelve quienes tienen el proyecto en un estado que modelamos', () => {
    projects.replaceForUser('raro', [
      { status: 'waiting_to_be_started', project: { id: PISCINA, name: 'Piscina' } },
      { status: 'trashed', project: { id: LIBFT, name: 'Libft' } },
    ])
    users.upsertMany([{ login: 'raro', id: 99 }])

    expect(projects.findPeers(PISCINA, CAMPUS).map((peer) => peer.login)).not.toContain('raro')
  })

  it('olvida un proyecto que alguien ya no tiene', () => {
    // La API dejó de devolverlo: es un snapshot, así que desaparece.
    projects.replaceForUser('albrodri', [])

    expect(projects.findPeers(PISCINA, CAMPUS).map((peer) => peer.login)).not.toContain('albrodri')
  })

  it('devuelve lista vacía para un proyecto sin participantes', () => {
    expect(projects.findPeers(999999, CAMPUS)).toEqual([])
  })

  it('expone el catálogo de proyectos', () => {
    expect(projects.exists(PISCINA)).toBe(true)
    expect(projects.exists(999999)).toBe(false)
    expect(projects.findNameById(LIBFT)).toBe('Libft')
    expect(projects.countParticipants(PISCINA)).toBe(4)
  })
})

describe('estado de la sincronización', () => {
  it('guarda y lee un valor', () => {
    syncState.set(SYNC_KEYS.LAST_USER, 'albrodri')

    expect(syncState.get(SYNC_KEYS.LAST_USER)).toBe('albrodri')
  })

  it('devuelve undefined si la clave no existe', () => {
    expect(syncState.get('nunca_escrita')).toBeUndefined()
  })

  it('guarda y lee fechas', () => {
    const moment = new Date('2026-10-04T10:00:00.000Z')
    syncState.setDate(SYNC_KEYS.CAMPUS_LOCATIONS, moment)

    expect(syncState.getDate(SYNC_KEYS.CAMPUS_LOCATIONS)?.toISOString()).toBe(
      '2026-10-04T10:00:00.000Z',
    )
  })

  it('trata un checkpoint corrupto como "nunca sincronizado"', () => {
    syncState.set(SYNC_KEYS.CAMPUS_LOCATIONS, 'no-es-una-fecha')

    // No debe lanzar: se sincroniza de cero antes que tumbar el arranque.
    expect(syncState.getDate(SYNC_KEYS.CAMPUS_LOCATIONS)).toBeUndefined()
  })

  it('sobrescribe sin duplicar la clave', () => {
    syncState.set(SYNC_KEYS.LAST_USER, 'albrodri')
    syncState.set(SYNC_KEYS.LAST_USER, 'plopez-l')

    expect(syncState.listAll()).toHaveLength(1)
    expect(syncState.get(SYNC_KEYS.LAST_USER)).toBe('plopez-l')
  })
})
