/**
 * Utilidades de cookies.
 *
 * Se separa de Fastify a propósito: el formato y la caducidad de una cookie se
 * pueden testear sin levantar el servidor.
 */

import type { FastifyReply } from 'fastify'

export type CookieOptions = {
  /** Vida en ms. Sin ella, cookie de sesión (se borra al cerrar el navegador). */
  maxAgeMs?: number
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'strict' | 'lax' | 'none'
  path?: string
}

/** `__Host-` exige `secure`, `path=/` y nada de `domain`. */
const SESSION_COOKIE = '__Host-sanatorio_session'
const STATE_COOKIE = '__Host-sanatorio_oauth_state'

/**
 * Nombre de la cookie de sesión.
 *
 * Con el prefijo `__Host-` el navegador solo la manda si viene por HTTPS y solo
 * al dominio exacto, así que ni un subdominio comprometido puede leerla ni
 * clonarla. El servidor tiene que estar en HTTPS; en local se usa `localhost`,
 * que los navegadores tratan como seguro.
 */
export const SESSION_COOKIE_NAME = SESSION_COOKIE

export const OAUTH_STATE_COOKIE_NAME = STATE_COOKIE

/** Serializa una cookie para `Set-Cookie`. */
export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${value}`]

  if (options.maxAgeMs !== undefined) {
    parts.push(`Max-Age=${Math.floor(options.maxAgeMs / 1000)}`)
  }
  if (options.path !== undefined) {
    parts.push(`Path=${options.path}`)
  }
  if (options.httpOnly ?? true) {
    parts.push('HttpOnly')
  }
  if (options.secure ?? true) {
    parts.push('Secure')
  }

  const sameSite = options.sameSite ?? 'lax'
  parts.push(`SameSite=${sameSite[0]?.toUpperCase() ?? 'L'}${sameSite.slice(1)}`)

  return parts.join('; ')
}

/**
 * Junta varias cookies en una respuesta.
 *
 * `reply.header('Set-Cookie', ...)` en Fastify **reemplaza** el valor anterior,
 * no lo añade: si una ruta manda dos cookies (limpiar el estado y poner la
 * sesión) con dos llamadas, solo sale una. Hay que pasar el array entero.
 */
export function setCookies(reply: FastifyReply, cookies: readonly string[]): void {
  if (cookies.length > 0) {
    reply.header('Set-Cookie', [...cookies])
  }
}

/** Cookie vaciada: hay que mandarla con los mismos atributos que se puso. */
export function clearCookie(name: string, options: CookieOptions = {}): string {
  return serializeCookie(name, '', { ...options, maxAgeMs: 0 })
}

/**
 * Lee una cookie del cabecera `Cookie`.
 *
 * Se separa de Fastify para poder testear el caso raro: nombres repetidos y
 * valores que llevan `=` dentro (nuestro `valor.firma` lleva uno).
 */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) {
    return undefined
  }

  for (const part of header.split(';')) {
    const separator = part.indexOf('=')

    if (separator < 0) {
      continue
    }

    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim()
    }
  }

  return undefined
}
