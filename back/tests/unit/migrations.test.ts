/**
 * Tests de las migraciones.
 *
 * Lo importante aquí es que el esquema se aplique bien **y solo una vez**: si
 * `user_version` no se respeta, una migración podría ejecutarse dos veces y
 * reventar al desplegar sobre una base que ya tenía datos.
 *
 * Todas las funciones son `async` porque `@libsql/client` no tiene API síncrona.
 */

import { describe, expect, it } from 'vitest'
import { createClient } from '@libsql/client'

import { assertSchemaIsCurrent, migrate, openDatabase, schemaVersion } from '../../src/db/database.js'
import type { Db } from '../../src/db/database.js'
import { LATEST_VERSION } from '../../src/db/migrations.js'
import { textOf } from '../helpers/rows.js'

/** Nombres de las tablas del esquema actual, sin las internas de SQLite. */
async function tableNames(db: Db): Promise<string[]> {
  const result = await db.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  )
  return result.rows.map((row) => textOf(row, 'name'))
}

describe('migraciones', () => {
  it('crea una base de datos nueva directamente en la última versión', async () => {
    const db = await openDatabase({ url: 'file::memory:' })

    expect(await schemaVersion(db)).toBe(LATEST_VERSION)
    await expect(assertSchemaIsCurrent(db)).resolves.toBeUndefined()

    db.close()
  })

  it('crea solo las dos tablas del esquema mínimo', async () => {
    const db = await openDatabase({ url: 'file::memory:' })

    expect((await tableNames(db)).sort()).toEqual(['availability', 'cache'])

    db.close()
  })

  it('no deja ninguna tabla de la réplica anterior', async () => {
    const db = await openDatabase({ url: 'file::memory:' })

    const names = await tableNames(db)

    for (const obsoleta of ['users', 'projects', 'user_projects', 'sync_state']) {
      expect(names).not.toContain(obsoleta)
    }

    db.close()
  })

  it('no vuelve a aplicar migraciones ya ejecutadas', async () => {
    const db = await openDatabase({ url: 'file::memory:' })

    expect(await migrate(db)).toEqual([])
    expect(await schemaVersion(db)).toBe(LATEST_VERSION)

    db.close()
  })

  it('avisa si el esquema está por detrás del código', async () => {
    const db = await openDatabase({ url: 'file::memory:' })

    // Simula una base desplegada con el esquema viejo, que llegaba a la versión 3.
    await db.execute('PRAGMA user_version = 3')

    await expect(assertSchemaIsCurrent(db)).rejects.toThrow(/está en la versión 3/)
  })

  it('aplica la migración a una base con el esquema de la réplica anterior', async () => {
    // Cliente a pelo, sin pasar por `openDatabase`: este ya aplica migraciones, y
    // lo que se quiere aquí es una base en el estado en que la dejó la versión 3.
    const db = createClient({ url: 'file::memory:' })

    // Monta a mano lo que dejó la versión 3 del esquema antiguo, con una persona
    // marcada como de guardia y con su fila de réplica.
    await db.batch([
      `CREATE TABLE users (
         login      TEXT PRIMARY KEY,
         user_id    INTEGER NOT NULL,
         synced_at  TEXT NOT NULL
       )`,
      `CREATE TABLE projects (
         id         INTEGER PRIMARY KEY,
         name       TEXT NOT NULL,
         synced_at  TEXT NOT NULL
       )`,
      `CREATE TABLE user_projects (
         login      TEXT NOT NULL,
         project_id INTEGER NOT NULL,
         status     TEXT NOT NULL
       )`,
      `CREATE TABLE availability (
         login      TEXT PRIMARY KEY,
         available  INTEGER NOT NULL DEFAULT 0,
         updated_at TEXT NOT NULL
       )`,
      `CREATE TABLE sync_state (
         id          INTEGER PRIMARY KEY CHECK (id = 1),
         cursor      TEXT,
         last_sync   TEXT
       )`,
      `INSERT INTO users (login, user_id, synced_at) VALUES ('albrodri', 1, '2026-01-01')`,
      `INSERT INTO availability (login, available, updated_at) VALUES ('albrodri', 1, '2026-01-01')`,
      'PRAGMA user_version = 3',
    ])

    // La versión nueva (10) es mayor que 3, así que sí se aplica.
    expect(await migrate(db)).toEqual([LATEST_VERSION])

    // La réplica desaparece…
    expect((await tableNames(db)).sort()).toEqual(['availability', 'cache'])

    // …pero la decisión de guardia se conserva. Es dato de la gente, no copia de
    // la API, y por eso esta migración no la toca.
    const guard = await db.execute('SELECT available FROM availability WHERE login = ?', ['albrodri'])
    expect(Number(guard.rows[0]?.available)).toBe(1)

    db.close()
  })

  it('avisa si la base está por delante del código', async () => {
    const db = await openDatabase({ url: 'file::memory:' })

    // Una base de un despliegue futuro: el código viejo no debe escribir encima.
    await db.execute('PRAGMA user_version = 99')

    await expect(assertSchemaIsCurrent(db)).rejects.toThrow(/está en la versión 99/)

    db.close()
  })
})