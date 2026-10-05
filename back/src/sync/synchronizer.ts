/**
 * Orquestador de la réplica local.
 *
 * Qué se sincroniza y con qué frecuencia está decidido por el presupuesto de
 * la API, no por las ganas de tener datos frescos: 1200 peticiones por hora
 * no dan para recorrer todo el campus. La estrategia es:
 *
 * - Globales y baratas en número: catálogo de proyectos y puestos del campus.
 * - Bajo demanda: los proyectos de quien entra, y los participantes de los
 *   proyectos que esa persona está haciendo.
 *
 * Así el campus entero (miles de personas) se replica con dos llamadas, y solo
 * se profundiza en quien realmente está usando la web.
 */

import type { FortyTwoClient } from '../api/client.js'
import { isUnauthorized } from '../api/errors.js'
import type { SyncStateRepository } from '../db/repositories/sync-state.js'
import { toUserInput } from '../db/repositories/users.js'
import type { Services } from '../services/container.js'
import type { SyncOutcome, SyncStepResult, SyncTarget } from './checkpoints.js'
import { FRESHNESS, shouldSync } from './freshness.js'
import { syncKeys } from './checkpoints.js'

/** Lo que el sincronizador necesita de la API de 42. */
export type SyncClient = Pick<
  FortyTwoClient,
  | 'getProjectCatalog'
  | 'getProjectParticipants'
  | 'getUser'
  | 'getUserProjects'
>

export type SynchronizerOptions = {
  services: Services
  client: SyncClient
  now?: () => number
  log?: (message: string) => void
}

export function createSynchronizer(options: SynchronizerOptions) {
  const { services, client } = options
  const now = options.now ?? Date.now
  const log = options.log ?? defaultLog

  const checkpoints: SyncStateRepository = services.repositories.syncState

  /** Envuelve un paso: comprueba frescura, mide, y marca solo si fue bien. */
  async function step(
    target: SyncTarget,
    key: string,
    rule: (typeof FRESHNESS)[keyof typeof FRESHNESS],
    run: () => Promise<number>,
  ): Promise<SyncStepResult> {
    const lastSync = checkpoints.getDate(key)

    if (!shouldSync(lastSync, rule, now())) {
      return { target, outcome: 'skipped_fresh' }
    }

    const startedAt = now()

    try {
      const count = await run()
      // Solo se marca si terminó bien. Un fallo deja el checkpoint viejo, que
      // es justo lo que hace que la próxima vuelta lo reintente.
      checkpoints.setDate(key, new Date(now()))

      const durationMs = now() - startedAt

      return { target, outcome: 'updated', count, durationMs }
    } catch (error) {
      const detail = describe(error)

      if (isUnauthorized(error)) {
        return { target, outcome: 'aborted_unauthorized', detail }
      }

      log(`sync ${target}: ${detail}`)

      return { target, outcome: 'failed', detail, durationMs: now() - startedAt }
    }
  }

  /**
   * Estado global: catálogo de proyectos y puestos del campus.
   *
   * El orden importa. `user_projects` y `user_locations` tienen claves
   * foráneas contra `projects` y `users`, así que el catálogo tiene que existir
   * antes de guardar las pertenencias de nadie.
   */
  async function syncGlobal(): Promise<SyncStepResult[]> {
    const catalog = await step(
      'projects_catalog',
      syncKeys.projectsCatalog(),
      FRESHNESS.projectsCatalog,
      async () => {
        const catalog = await client.getProjectCatalog()

        if (catalog.length === 0) {
          // Un catálogo vacío borraría los proyectos de todos y dejaría el
          // front sin nada. Mejor no tocarlo y esperar la próxima vuelta.
          throw new Error('la API ha devuelto un catálogo de proyectos vacío')
        }

        services.repositories.projects.upsertCatalog(catalog)

        return catalog.length
      },
    )

    // Las ubicaciones masivas del campus se descartan: `/campus/:id/locations`
    // devuelve el histórico completo (7 511 páginas en Madrid), lo que hace
    // inviable sincronizarlo dentro de la cuota. La ubicación actual se lee
    // directamente del objeto de usuario cuando aparece (participantes, /users/:login).
    return [catalog]
  }

  /**
   * Proyectos de una persona.
   *
   * Se llama al entrar: sin esto no hay forma de saber qué está haciendo.
   */
  async function syncUser(login: string): Promise<SyncStepResult[]> {
    const result = await step(
      'user_projects',
      syncKeys.userProjects(login),
      FRESHNESS.userProjects,
      async () => {
        const entries = await client.getUserProjects(login)

        // Se presupone que la persona existe: si ha entrado por OAuth, la
        // llamada anterior ya la guardó. Se sube igualmente su foto y nombre.
        services.repositories.users.upsertMany([
          toUserInput({ id: await resolveUserId(login), login }),
        ])
        services.repositories.projects.replaceForUser(login, entries)

        return entries.length
      },
    )

    return [result]
  }

  /** Id numérico de una persona, necesario para la clave foránea. */
  async function resolveUserId(login: string): Promise<number> {
    const known = services.repositories.users.findByLogin(login)

    if (known !== undefined) {
      return known.user_id
    }

    // No la teníamos: se pide a la API. Si tampoco aparece, es que el login no
    // existe en la 42 y no hay nada que replicar.
    const user = await client.getUser(login)
    services.repositories.users.upsertMany([toUserInput(user)])

    return user.id
  }

  /**
   * Participantes de un proyecto.
   *
   * Es lo que alimenta la lista de compañeros. Solo se llama para proyectos que
   * alguien de verdad está haciendo.
   */
  async function syncProjectParticipants(projectId: number): Promise<SyncStepResult[]> {
    const result = await step(
      'project_participants',
      syncKeys.projectParticipants(projectId),
      FRESHNESS.projectParticipants,
      async () => {
        const participants = await client.getProjectParticipants(projectId)

        services.repositories.users.upsertMany(participants.map(toUserInput))
        services.repositories.projects.addParticipants(
          projectId,
          participants.map((participant) => participant.login),
        )

        return participants.length
      },
    )

    return [result]
  }

  /**
   * Vuelta completa para una persona: lo global, lo suyo y los proyectos que
   * tiene en curso.
   *
   * Los proyectos se piden uno a uno a propósito: el limitador los serializa
   * igual, y así el log dice en qué se iba cuando algo falle.
   */
  async function syncEverythingFor(login: string): Promise<SyncStepResult[]> {
    const results = await syncGlobal()
    results.push(...(await syncUser(login)))

    // Si los proyectos de la persona no se pudieron leer, no hay ids que
    // recorrer y pedir participantes sería trabajo a ciegas.
    const lastStep = results.at(-1)

    if (lastStep?.outcome !== 'updated' && lastStep?.outcome !== 'skipped_fresh') {
      return results
    }

    const inProgress = services.projects.findInProgressByUser(login)

    for (const project of inProgress) {
      results.push(...(await syncProjectParticipants(project.id)))
    }

    return results
  }

  return {
    syncGlobal,
    syncUser,
    syncProjectParticipants,
    syncEverythingFor,

    /** Resumen para logs: qué se hizo y qué se saltó. */
    summarize(results: readonly SyncStepResult[]): string {
      const counted = new Map<SyncOutcome, number>()

      for (const result of results) {
        counted.set(result.outcome, (counted.get(result.outcome) ?? 0) + 1)
      }

      const parts = [...counted].map(([outcome, total]) => `${outcome}:${total}`)

      return parts.length === 0 ? 'nada que hacer' : parts.join(' ')
    },
  }
}

/** Por defecto, los avisos de fallo van a stderr. */
function defaultLog(message: string): void {
  process.stderr.write(`[sync] ${message}\n`)
}

/** Mensaje legible de cualquier fallo, sin filtrar tokens ni cabeceras. */
function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

export type Synchronizer = ReturnType<typeof createSynchronizer>
