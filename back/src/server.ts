/**
 * Punto de entrada.
 *
 * Todo el trabajo está en `app.ts`; aquí solo se abre el puerto y se apaga
 * sin dejar procesos colgando.
 */

import { buildApp } from './app.js'
import { describeError } from './cli/describe-error.js'

const { app, env, close } = buildApp()

/** Apagado ordenado: primero dejar de aceptar conexiones, luego cerrar la base. */
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown(signal)
  })
}

let apagando = false

async function shutdown(signal: string): Promise<void> {
  if (apagando) {
    return
  }
  apagando = true

  process.stdout.write(`${signal} recibido, cerrando\n`)

  try {
    await close()
    process.exitCode = 0
  } catch (error) {
    process.stderr.write(`apagado con errores: ${describeError(error)}\n`)
    process.exitCode = 1
  }
}

try {
  await app.listen({ port: env.PORT, host: env.HOST })
  process.stdout.write(`escuchando en ${env.HOST}:${env.PORT}\n`)
} catch (error) {
  process.stderr.write(`no se pudo arrancar: ${describeError(error)}\n`)
  process.exitCode = 1
}
