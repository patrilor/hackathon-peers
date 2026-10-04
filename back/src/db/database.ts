/**
 * Apertura y configuración de la base de datos SQLite.
 *
 * better-sqlite3 es síncrono a propósito: en un backend de este tamaño evita
 * el ruido de `await` en todas las consultas y hace que las transacciones
 * sean triviales de escribir bien.
 */

import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { LATEST_VERSION, MIGRATIONS } from './migrations.js'

export type Db = Database.Database

/**
 * Abre la base de datos, aplica los PRAGMAs y ejecuta las migraciones pendientes.
 *
 * @param path Ruta del fichero, o `:memory:` para una base temporal en memoria.
 *             Las rutas relativas se resuelven contra el directorio de trabajo.
 */
export function openDatabase(path: string): Db {
  const isMemory = path === ':memory:'
  const resolved = isMemory ? path : resolve(process.cwd(), path)

  // `data/` no existe en un repo recién clonado, y SQLite no crea directorios.
  if (!isMemory) {
    mkdirSync(dirname(resolved), { recursive: true })
  }

  const db = new Database(resolved)

  // WAL: permite lecturas mientras se escribe. Sin esto, una sincronización
  // larga bloquearía las peticiones de los usuarios viendo la lista de peers.
  db.pragma('journal_mode = WAL')
  // Las claves foráneas están apagadas por defecto en SQLite. Sin activarlas,
  // los ON DELETE CASCADE del esquema no se aplican.
  db.pragma('foreign_keys = ON')
  // Espera hasta 5 s a que se libere un candado en vez de fallar al instante.
  db.pragma('busy_timeout = 5000')

  migrate(db)

  return db
}

/**
 * Ejecuta las migraciones que falten, una a una y dentro de su transacción.
 *
 * Cada migración se aplica junto a la actualización de `user_version`, de modo
 * que un fallo a mitad no deja la base en un estado intermedio.
 */
export function migrate(db: Db): number[] {
  const current = db.pragma('user_version', { simple: true }) as number
  const pending = MIGRATIONS.filter((migration) => migration.version > current)

  const applied: number[] = []
  for (const migration of pending) {
    const run = db.transaction(() => {
      for (const statement of migration.statements) {
        db.exec(statement)
      }
      // `PRAGMA` no admite parámetros vinculados: hay que interpolar. El valor
      // es un entero de este mismo array, así que no hay inyección posible.
      db.exec(`PRAGMA user_version = ${migration.version}`)
    })
    run()
    applied.push(migration.version)
  }

  return applied
}

/** Versión del esquema actualmente aplicada. */
export function schemaVersion(db: Db): number {
  return db.pragma('user_version', { simple: true }) as number
}

/**
 * Comprueba que la base de datos está al día con el código.
 *
 * Útil al arrancar: si alguien despliega un código nuevo sin las migraciones
 * correspondientes, es mejor fallar con un mensaje claro que con un error raro
 * más tarde.
 */
export function assertSchemaIsCurrent(db: Db): void {
  const current = schemaVersion(db)
  if (current !== LATEST_VERSION) {
    throw new Error(
      `El esquema de la base de datos está en la versión ${current} y el código ` +
        `espera la ${LATEST_VERSION}. Ejecuta las migraciones antes de arrancar.`,
    )
  }
}

/** Cierra la base de datos. Ejecuta un checkpoint de WAL para no dejar restos. */
export function closeDatabase(db: Db): void {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
  } catch {
    // Si el checkpoint falla (base ya cerrada), no es motivo para fallar.
  } finally {
    db.close()
  }
}

/** Marca de tiempo ISO-8601, formato único para todas las columnas `*_at`. */
export function nowIso(): string {
  return new Date().toISOString()
}
