/**
 * Mensaje de un fallo, sea lo que sea.
 *
 * `String(error)` sobre un objeto plano da `[object Object]`, que no ayuda a
 * nadie a las dos de la mañana.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  try {
    return JSON.stringify(error)
  } catch {
    return 'error desconocido'
  }
}
