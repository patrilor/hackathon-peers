/**
 * Tests de las migraciones.
 *
 * Lo importante aquí es que el esquema se aplique bien **y solo una vez**: si
 * `user_version` no se respeta, una migración podría ejecutarse dos veces y
 * reventar al desplegar sobre una base que ya tenía datos.
 */

import { describe, expect, it } from 'vitest'

import { assertSchemaIsCurrent, migrate, openDatabase, schemaVersion } from '../../src/db/database.js'
import { LATEST_VERSION } from '../../src/db/migrations.js'

describe('migraciones', () => {
  it('crea un base de datos nueva directamente en la última versión', () => {
    const db = openDatabase(':memory:')

    expect(schemaVersion(db)).toBe(LATEST_VERSION)
    expect(() => {
      assertSchemaIsCurrent(db)
    }).not.toThrow()
  })

  it('crea todas las tablas del esquema', () => {
    const db = openDatabase(':memory:')

    const tables = db
      .prepare<unknown[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name)

    expect(tables).toEqual(
      expect.arrayContaining([
        'users',
        'user_locations',
        'projects',
        'user_projects',
        'availability',
        'sync_state',
      ]),
    )
  })

  it('no vuelve a aplicar migraciones ya ejecutadas', () => {
    const db = openDatabase(':memory:')

    expect(migrate(db)).toEqual([])
    expect(schemaVersion(db)).toBe(LATEST_VERSION)
  })

  it('activa las claves foráneas, que en SQLite vienen apagadas', () => {
    const db = openDatabase(':memory:')

    const enabled = db.pragma('foreign_keys', { simple: true })
    expect(enabled).toBe(1)
  })

  it('avisa si el esquema está por detrás del código', () => {
    const db = openDatabase(':memory:')
    // Simula una base desplegada con una versión antigua.
    db.exec('PRAGMA user_version = 0')

    expect(() => {
      assertSchemaIsCurrent(db)
    }).toThrow(/está en la versión 0/)
  })

  it('aplica el ON DELETE CASCADE declarado en el esquema', () => {
    const db = openDatabase(':memory:')

    db.prepare(
      "INSERT INTO users (login, user_id, synced_at) VALUES ('albrodri', 1, '2026-01-01')",
    ).run()
    db.prepare(
      `INSERT INTO availability (login, available, updated_at)
       VALUES ('albrodri', 1, '2026-01-01')`,
    ).run()
    // Sin el cascade, esta fila sobreviviría al borrado de la persona.
    db.prepare("DELETE FROM users WHERE login = 'albrodri'").run()

    const remaining = db
      .prepare<unknown[], { total: number }>('SELECT COUNT(*) AS total FROM availability')
      .get()

    expect(remaining?.total).toBe(0)
  })
})