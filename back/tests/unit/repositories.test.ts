/**
 * Tests de los repositorios.
 *
 * Aquí se prueba la lógica que hace que Sanatorio sirva para algo: cruzar
 * proyectos, ubicaciones y disponibilidad. Si esto falla, la web muestra
 * peers equivocados, y no hay forma de que alguien se entere.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { openDatabase, type Db } from '../../src/db/database.js'
import { createUsersRepository, toUserInput } from '../../src/db/repositories/users.js'
import { createProjectsRepository, normalizeStatus } from '../../src/db/repositories/projects.js'
import { createAvailabilityRepository } from '../../src/db/repositories/availability.js'
import { createSyncStateRepository, SYNC_KEYS } from '../../src/db/repositories/sync-state.js'

const PISCINA = 2609 // "Piscina", el proyecto que usan los ejemplos de la API
const LIBFT = 1337

let db: Db
let users: ReturnType<typeof createUsersRepository>
let projects: ReturnType<typeof createProjectsRepository>
let availability: ReturnType<typeof createAvailabilityRepository>
let syncState: ReturnType<typeof createSyncStateRepository>

/** Entrada de campus con los campos mínimos que usa el repositorio. */
beforeEach(() => {
  db = openDatabase(':memory:')
  users = createUsersRepository(db)
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

  it('guarda la ubicación que trae la API', () => {
    users.upsertMany([{ login: 'albrodri', id: 42, location: 'c2r17s2' }])

    expect(users.findByLogin('albrodri')?.current_location).toBe('c2r17s2')
    expect(users.findByLogin('albrodri')?.location_synced_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('borra la ubicación cuando la API dice que ya no está en el campus', () => {
    users.upsertMany([{ login: 'albrodri', id: 42, location: 'c2r17s2' }])
    users.upsertMany([{ login: 'albrodri', id: 42, location: null }])

    expect(users.findByLogin('albrodri')?.current_location).toBeNull()
  })

  it('NO borra la ubicación si el endpoint no habla de ubicaciones', () => {
    // El matiz que hace que todo esto funcione: `undefined` es "este endpoint no
    // dice dónde está", no "no está". `/projects_users` manda resúmenes sin
    // `location`, y si se tomaran como `null` todo el mundo aparecería fuera del
    // campus en cuanto se sincronizara cualquier proyecto.
    users.upsertMany([{ login: 'albrodri', id: 42, location: 'c2r17s2' }])
    users.upsertMany([{ login: 'albrodri', id: 42, imageUrl: 'https://cdn/nuevo.jpg' }])

    expect(users.findByLogin('albrodri')?.current_location).toBe('c2r17s2')
    // La foto sí se actualiza: cada endpoint solo informa de lo suyo.
    expect(users.findByLogin('albrodri')?.image_url).toBe('https://cdn/nuevo.jpg')
  })

  it('propaga undefined como "no informado" desde el objeto de la API', () => {
    // `toUserInput` no debe convertir el `undefined` de la API en `null`, o el
    // test anterior pasaría por casualidad y este por nada.
    expect(toUserInput({ id: 1, login: 'albrodri' }).location).toBeUndefined()
    expect(toUserInput({ id: 1, login: 'albrodri', location: null }).location).toBeNull()
    expect(toUserInput({ id: 1, login: 'albrodri', location: 'c1r2s1' }).location).toBe('c1r2s1')
  })
})

describe('ubicaciones y disponibilidad', () => {
  beforeEach(() => {
    users.upsertMany([
      { login: 'albrodri', id: 1, location: 'c2r17s2' },
      { login: 'plopez-l', id: 2, location: null },
    ])
  })

  it('conserva la disponibilidad de quien se va del campus', () => {
    availability.set('albrodri', true)

    // La disponibilidad es un dato nuestro y no se borra al salir del campus.
    // Lo que decide si está "de guardia" es la combinación de los dos campos.
    expect(availability.get('albrodri')).toBe(true)

    // Al irse del campus, lo que se pierde es el puesto, no la guardia.
    users.upsertMany([{ login: 'albrodri', id: 1, location: null }])

    expect(users.findByLogin('albrodri')?.current_location).toBeNull()
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
      { login: 'albrodri', id: 1, imageUrl: 'https://cdn/a.jpg', location: 'c2r17s2' },
      { login: 'plopez-l', id: 2, location: null },
      { login: 'legomez', id: 3, location: 'c2r20s1' },
      { login: 'outsider', id: 4, location: null },
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

    // Solo albrodri está de guardia. Se marca después de insertar las personas
    // porque `availability.login` es clave foránea contra `users.login`.
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
    const peers = projects.findPeers(PISCINA)

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
    const peers = projects.findPeers(PISCINA)
    const byLogin = new Map(peers.map((peer) => [peer.login, peer]))

    expect(byLogin.get('albrodri')?.location).toBe('c2r17s2')
    expect(byLogin.get('plopez-l')?.location).toBeNull()
    expect(byLogin.get('outsider')?.location).toBeNull()
  })

  it('olvida una ubicación que lleva demasiado tiempo sin refrescar', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-10-04T12:00:00.000Z'))

      // Se reinscribe con el reloj congelado para que `location_synced_at` sea
      // ese momento y no el real, con el que el corte no tendría sentido.
      users.upsertMany([
        { login: 'albrodri', id: 1, imageUrl: 'https://cdn/a.jpg', location: 'c2r17s2' },
      ])

      expect(projects.findPeers(PISCINA).find((p) => p.login === 'albrodri')?.location).toBe('c2r17s2')

      // Pasada la ventana, el puesto del cluster sigue ahí en la base pero ya no
      // se cuenta: puede que la persona se levantara hace media hora.
      vi.setSystemTime(new Date('2026-10-04T12:31:00.000Z'))

      const peer = projects.findPeers(PISCINA).find((p) => p.login === 'albrodri')

      expect(peer?.location).toBeNull()
      // Caducar la ubicación no debe tocar nada más del peer.
      expect(peer?.available).toBe(true)
      expect(peer?.image).toBe('https://cdn/a.jpg')
    } finally {
      vi.useRealTimers()
    }
  })

  it('marca como especialista a quien ya aprobó el proyecto', () => {
    const peers = projects.findPeers(PISCINA)
    const byLogin = new Map(peers.map((peer) => [peer.login, peer]))

    expect(byLogin.get('albrodri')?.status).toBe('in_progress')
    expect(byLogin.get('legomez')?.status).toBe('finished')
  })

  it('deja available en false a quien no ha marcado disponibilidad', () => {
    const peers = projects.findPeers(PISCINA)
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

    expect(projects.findPeers(PISCINA).map((peer) => peer.login)).not.toContain('raro')
  })

  it('olvida un proyecto que alguien ya no tiene', () => {
    // La API dejó de devolverlo: es un snapshot, así que desaparece.
    projects.replaceForUser('albrodri', [])

    expect(projects.findPeers(PISCINA).map((peer) => peer.login)).not.toContain('albrodri')
  })

  it('devuelve lista vacía para un proyecto sin participantes', () => {
    expect(projects.findPeers(999999)).toEqual([])
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
    syncState.setDate(SYNC_KEYS.USER_PROJECTS, moment)
    expect(syncState.getDate(SYNC_KEYS.USER_PROJECTS)?.toISOString()).toBe('2026-10-04T10:00:00.000Z')
  })

  it('trata un checkpoint corrupto como "nunca sincronizado"', () => {
    syncState.set(SYNC_KEYS.USER_PROJECTS, 'no-es-una-fecha')

    // No debe lanzar: se sincroniza de cero antes que tumbar el arranque.
    expect(syncState.getDate(SYNC_KEYS.USER_PROJECTS)).toBeUndefined()
  })

  it('sobrescribe sin duplicar la clave', () => {
    syncState.set(SYNC_KEYS.LAST_USER, 'albrodri')
    syncState.set(SYNC_KEYS.LAST_USER, 'plopez-l')

    expect(syncState.listAll()).toHaveLength(1)
    expect(syncState.get(SYNC_KEYS.LAST_USER)).toBe('plopez-l')
  })
})
