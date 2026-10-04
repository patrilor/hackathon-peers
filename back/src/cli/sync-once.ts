/**
 * `npm run sync -- <login>`: fuerza una vuelta de sincronización y sale.
 *
 * Para cuando hay que rellenar datos a mano (una persona que se acaba de dar de
 * alta, un campus nuevo) sin esperar a que el servidor lo haga solo. Respeta
 * los checkpoints, así que `--force` es lo que de verdad manda.
 */

import { createApiClient } from '../api/create-client.js'
import { loadEnv } from '../config/env.js'
import { closeDatabase, openDatabase } from '../db/database.js'
import { createServices } from '../services/container.js'
import { createSynchronizer } from '../sync/synchronizer.js'
import type { SyncStepResult } from '../sync/checkpoints.js'
import { describeError } from './describe-error.js'

/** `--force` ignora la frescura y rehace los pasos. */
function wantsForce(argv: readonly string[]): boolean {
  return argv.includes('--force')
}

/** Login pedido, si lo hay. */
function requestedLogin(argv: readonly string[]): string | undefined {
  return argv.find((arg) => !arg.startsWith('-'))
}

/** Una línea por paso: qué se hizo, cuánto tardó y cuántos elementos. */
function describe(result: SyncStepResult): string {
  const partes = [`${result.target}: ${result.outcome}`]

  if (result.count !== undefined) {
    partes.push(`${result.count} elementos`)
  }
  if (result.durationMs !== undefined) {
    partes.push(`${result.durationMs} ms`)
  }
  if (result.detail !== undefined) {
    partes.push(result.detail)
  }

  return partes.join(' | ')
}

async function main(): Promise<void> {
  const env = loadEnv()
  const argv = process.argv.slice(2)
  const login = requestedLogin(argv)
  const force = wantsForce(argv)

  const db = openDatabase(env.DATABASE_PATH)
  const services = createServices(db, env.CAMPUS_ID)
  const client = createApiClient(env)
  const synchronizer = createSynchronizer({
    services,
    client,
    campusId: env.CAMPUS_ID,
  })

  if (force) {
    // Sin esto, los checkpoints frescos hacen que el comando no haga nada, que
    // es justo lo contrario de lo que se espera de un `sync --force`.
    for (const key of ['sync:projects:catalog', `sync:campus:${env.CAMPUS_ID}:locations`]) {
      services.repositories.syncState.delete(key)
    }
    process.stdout.write('checkpoints globales borrados\n')
  }

  const results =
    login === undefined
      ? await synchronizer.syncGlobal()
      : await synchronizer.syncEverythingFor(login)

  for (const result of results) {
    process.stdout.write(`${describe(result)}\n`)
  }

  process.stdout.write(`resumen: ${synchronizer.summarize(results)}\n`)

  const fallo = results.some((result) => result.outcome === 'failed')
  closeDatabase(db)

  if (fallo) {
    process.exitCode = 1
  }
}

try {
  await main()
} catch (error) {
  process.stderr.write(`sync fallido: ${describeError(error)}\n`)
  process.exitCode = 1
}
