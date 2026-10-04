/**
 * Errores de negocio, distinguibles de los fallos técnicos.
 *
 * El servidor los traduce a un código HTTP (ver `src/server`), así que aquí no
 * hay ningún `status` ni rastro de Fastify: los servicios no saben que existe
 * una capa web.
 */

export type DomainErrorCode =
  /** No hay sesión, o la sesión no corresponde a nadie. */
  | 'unauthenticated'
  /** El recurso pedido no existe. */
  | 'not_found'
  /** La petición está mal formada. */
  | 'invalid_input'

export class DomainError extends Error {
  readonly code: DomainErrorCode

  constructor(code: DomainErrorCode, message: string) {
    super(message)
    this.name = 'DomainError'
    this.code = code
  }
}

/** Atajo legible para los tres casos. */
export function domainError(code: DomainErrorCode, message: string): DomainError {
  return new DomainError(code, message)
}