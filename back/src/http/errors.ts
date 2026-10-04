/**
 * De `DomainError` a código HTTP.
 *
 * La decisión vive en un solo sitio para que los tests puedan comprobar cada
 * código sin levantar el servidor.
 */

import { DomainError } from '../domain/errors.js'
import { ApiError } from '../api/errors.js'

export type ErrorMapping = {
  status: number
  /** Cuerpo JSON que ve el front. */
  body: { error: string; message: string }
}

export function statusForError(error: unknown): number {
  if (error instanceof DomainError) {
    switch (error.code) {
      case 'unauthenticated':
        return 401
      case 'not_found':
        return 404
      case 'invalid_input':
        return 400
      default:
        return 500
    }
  }

  // Un 429 de la 42 hacia el front es un 503: no es culpa de quien está
  // usando la web y no puede arreglarlo reintentando.
  if (error instanceof ApiError) {
    return error.status === 429 ? 503 : error.status
  }

  return 500
}

export function mapError(error: unknown): ErrorMapping {
  if (error instanceof DomainError) {
    return {
      status: statusForError(error),
      body: { error: error.code, message: error.message },
    }
  }

  if (error instanceof ApiError) {
    return {
      status: statusForError(error),
      body: { error: error.code, message: error.message },
    }
  }

  // Lo que no se reconoce se registra entero pero al front solo se le da un
  // mensaje genérico: un error interno puede traer rutas de ficheros o SQL.
  return {
    status: 500,
    body: {
      error: 'internal_error',
      message: 'Algo ha ido mal por nuestra parte. Prueba de nuevo en un momento.',
    },
  }
}
