/**
 * Punto de entrada para desarrollo local.
 *
 * Todo el trabajo está en `app.ts`; aquí solo se abre el puerto y se apaga sin
 * dejar procesos colgando. En producción este archivo no se usa: el mismo
 * `app.ts` lo monta `src/vercel.ts`, el puente al que llaman las funciones de
 * `api/`.
 */

import { buildApp } from './app.js'

const built = await buildApp()
const { app, env, close } = built

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
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`apagado con errores: ${message}\n`)
    process.exitCode = 1
  }
}

try {
  await app.listen({ port: env.PORT, host: env.HOST })
  process.stdout.write(`escuchando en ${env.HOST}:${env.PORT}\n`)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`no se pudo arrancar: ${message}\n`)
  process.exitCode = 1
}