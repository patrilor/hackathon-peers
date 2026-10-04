/**
 * `npm run db:migrate`: aplica las migraciones pendientes y sale.
 *
 * Separado del arranque del servidor a propósito: en producción es mejor
 * migrar como un paso explícito y poder ver el fallo, que enterarse porque el
 * servidor no llegó a levantar.
 */

import { loadEnv } from '../config/env.js'
import { closeDatabase, openDatabase } from '../db/database.js'
import { describeError } from './describe-error.js'

function main(): void {
  // Se carga el entorno solo para validar la configuración: si algo está mal,
  // mejor saberlo antes de tocar la base.
  const env = loadEnv()

  const db = openDatabase(env.DATABASE_PATH)
  closeDatabase(db)

  process.stdout.write('migraciones aplicadas\n')
}

try {
  main()
} catch (error) {
  process.stderr.write(`migración fallida: ${describeError(error)}\n`)
  process.exitCode = 1
}
