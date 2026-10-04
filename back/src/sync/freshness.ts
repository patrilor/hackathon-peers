/**
 * Cuándo merece la pena volver a pedir algo a la 42.
 *
 * Dosforceable que tiran en direcciones distintas:
 *
 * - `minAgeMs`: si se sincronizó hace nada, no molestar. Las ubicaciones
 *   cambian cada cierto rato y pedirlas cuesta una llamada de un minuto.
 * - `maxStalenessMs`: pasado ese tiempo hay que actualizar aunque se pida
 *   "fresco". Si no, un sincronizador que solo respeta el margen mínimo
 *   acabaría sin refrescar nada nunca.
 */

export type FreshnessRule = {
  /** Antes de esto, se considera fresco y se salta la llamada. */
  minAgeMs: number
  /** Pasado esto, se sincroniza siempre. */
  maxStalenessMs: number
}

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE

export const FRESHNESS = {
  /**
   * Puestos del campus. La llamada tarda cerca de un minuto, así que el
   * margen de frescura tiene que ser holgado o se pasa el rato refrescando.
   */
  campusLocations: { minAgeMs: 10 * MINUTE, maxStalenessMs: 30 * MINUTE },
  /**
   * El catálogo cambia muy pocas veces. Casi nunca hay que pedirlo.
   */
  projectsCatalog: { minAgeMs: 6 * HOUR, maxStalenessMs: 24 * HOUR },
  /**
   * Proyectos de una persona. Se pide al entrar, y se respeta un margen
   * corto por si refresca la página varias veces seguidas.
   */
  userProjects: { minAgeMs: 5 * MINUTE, maxStalenessMs: 30 * MINUTE },
  /**
   * Participantes de un proyecto. Al abrir la lista de compañeros, que es
   * justo cuando interesa saber quién acaba de fichar.
   */
  projectParticipants: { minAgeMs: 2 * MINUTE, maxStalenessMs: 15 * MINUTE },
} as const satisfies Record<string, FreshnessRule>

/**
 * ¿Hay que llamar a la API?
 *
 * Nunca sincronizado: siempre. Caducado por `maxStalenessMs`: siempre. Entre
 * medias: solo si se ha pasado `minAgeMs`.
 */
export function shouldSync(lastSync: Date | undefined, rule: FreshnessRule, now: number): boolean {
  if (lastSync === undefined) {
    return true
  }

  const age = now - lastSync.getTime()

  // Un checkpoint con fecha futura (reloj desincronizado, copia de la base)
  // no debe hacer que el dato se considere eternally fresco.
  if (age < 0) {
    return true
  }

  return age >= rule.maxStalenessMs || age >= rule.minAgeMs
}
