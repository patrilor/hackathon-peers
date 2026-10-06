/**
 * Apertura y configuración de la base de datos.
 *
 * Se usa `@libsql/client` y no `better-sqlite3` por un motivo concreto: vamos a
 * desplegar en Vercel, y Vercel ejecuta cada petición en un runtime que no
 * permite confiar en binarios nativos. `@libsql/client` habla HTTP, así que no
 * hay nada que compilar ni que cargar, y además sirve para Turso (producción) y
 * para un fichero SQLite local (desarrollo y tests) con el mismo código.
 *
 * El precio es que las consultas son `async`. Es asumible: en este back hay dos
 * tablas y la latencia de red dwarfs cualquier ahorro de `await`.
 */

import { mkdirSync } from 'node:fs'

import { createClient } from '@libsql/client'
import type { Client } from '@libsql/client'

import { LATEST_VERSION, MIGRATIONS } from './migrations.js'

export type Db = Client

export type DatabaseOptions = {
  /** `libsql://…` para Turso, `file:…` para un SQLite local. */
  url: string
  /** Token de Turso. Se ignora con `file:`. */
  authToken?: string | undefined
}

/**
 * Abre la conexión y ejecuta las migraciones pendientes.
 *
 * Con `file:` se crean los directorios que falten: `data/` no existe en un repo
 * recién clonado y SQLite no crea directorios por su cuenta.
 */
export async function openDatabase(options: DatabaseOptions): Promise<Db> {
  if (options.url.startsWith('file:')) {
    ensureParentDirectory(options.url)
  }

  const db = createClient({
    url: options.url,
    ...(options.authToken === undefined || options.authToken === ''
      ? {}
      : { authToken: options.authToken }),
  })

  await migrate(db)

  return db
}

/**
 * Ejecuta las migraciones que falten, una a una y dentro de su transacción.
 *
 * Cada migración se aplica junto a la actualización de `user_version`, de modo
 * que un fallo a mitad no deja la base en un estado intermedio. `batch` es
 * atómico: o entra la migración entera, o no entra nada.
 */
export async function migrate(db: Db): Promise<number[]> {
  const current = await schemaVersion(db)
  const pending = MIGRATIONS.filter((migration) => migration.version > current)

  const applied: number[] = []
  for (const migration of pending) {
    // `PRAGMA` no admite parámetros vinculados: hay que interpolar. El valor es
    // un entero de este mismo array, así que no hay inyección posible.
    await db.batch([
      ...migration.statements,
      `PRAGMA user_version = ${migration.version}`,
    ])
    applied.push(migration.version)
  }

  return applied
}

/** Versión del esquema actualmente aplicada. */
export async function schemaVersion(db: Db): Promise<number> {
  const result = await db.execute('PRAGMA user_version')
  const row = result.rows[0]

  return row === undefined ? 0 : Number(row.user_version ?? 0)
}

/**
 * Comprueba que la base de datos está al día con el código.
 *
 * Útil al arrancar: si alguien despliega un código nuevo sin las migraciones
 * correspondientes, es mejor fallar con un mensaje claro que con un error raro
 * más tarde.
 */
export async function assertSchemaIsCurrent(db: Db): Promise<void> {
  const current = await schemaVersion(db)
  if (current !== LATEST_VERSION) {
    throw new Error(
      `El esquema de la base de datos está en la versión ${current} y el código ` +
        `espera la ${LATEST_VERSION}. Ejecuta las migraciones antes de arrancar.`,
    )
  }
}

/**
 * Las claves foráneas están apagadas por defecto en SQLite.
 *
 * Con `better-sqlite3` era un `PRAGMA` en la apertura. `@libsql/client` expone
 * `foreignKeys` como opción del cliente y lo aplica en la conexión, así que se
 * deja aquí solo como comprobación de que no se nos olvide.
 */
export async function foreignKeysEnabled(db: Db): Promise<boolean> {
  const result = await db.execute('PRAGMA foreign_keys')
  const row = result.rows[0]

  return row !== undefined && Number(row.foreign_keys ?? 0) === 1
}

/** Cierra la conexión. Idempotente. */
export function closeDatabase(db: Db): void {
  db.close()
}

/** Marca de tiempo ISO-8601, formato único para todas las columnas `*_at`. */
export function nowIso(): string {
  return new Date().toISOString()
}

/** Timestamp ISO dentro de `seconds`, para las columnas `expires_at` del caché. */
export function isoIn(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString()
}

/** `true` si la fecha ISO está en el pasado. */
export function isExpired(iso: string): boolean {
  return Date.parse(iso) <= Date.now()
}

/** Crea el directorio que contiene el fichero de la base, si falta. */
function ensureParentDirectory(url: string): void {
  const path = url.slice('file:'.length).split('?')[0] ?? ''
  const separator = path.lastIndexOf('/')

  if (separator <= 0) {
    return
  }

  mkdirSync(path.slice(0, separator), { recursive: true })
}