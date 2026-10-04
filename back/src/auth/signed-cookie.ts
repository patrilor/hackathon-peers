/**
 * Cookies firmadas con HMAC-SHA256.
 *
 * Se usa para dos cosas: la sesión (que solo lleva un identificador opaco) y
 * el `state` anti-CSRF del login. Ninguna lleva secretos dentro: la cookie va
 * firmada, no cifrada, así que su contenido tiene que poder ir en claro.
 *
 * Formato: `valor.firma`, todo en base64url. Un valor manipulado hace que la
 * firma no cuadre y se descarta.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/** Bytes de entropía por token. 32 es lo habitual para identificadores. */
const DEFAULT_BYTES = 32

/** Base64url, sin `=` ni `+` ni `/`: es lo único válido dentro de una cookie. */
export function base64url(input: Buffer): string {
  return input.toString('base64url')
}

/** Aleatoriedad criptográficamente segura, en base64url. */
export function randomToken(bytes = DEFAULT_BYTES): string {
  return base64url(randomBytes(bytes))
}

function signature(secret: string, payload: string): string {
  return base64url(createHmac('sha256', secret).update(payload).digest())
}

/** Firma un valor: devuelve `valor.firma`. */
export function sign(secret: string, payload: string): string {
  return `${payload}.${signature(secret, payload)}`
}

/**
 * Comprueba una firma y devuelve el valor original.
 *
 * `undefined` si no cuadra. La comparación es de tiempo constante: comparando
 * carácter a carácter se filtraría el valor correcto byte a byte.
 */
export function verify(secret: string, signed: string): string | undefined {
  const separator = signed.lastIndexOf('.')

  if (separator <= 0) {
    return undefined
  }

  const payload = signed.slice(0, separator)
  const provided = Buffer.from(signed.slice(separator + 1), 'base64url')
  const expected = Buffer.from(signature(secret, payload), 'base64url')

  // Dos buffers de distinta longitud no se pueden comparar en tiempo constante.
  // Se descartan antes, y no importa: que el atacante sepa la longitud de una
  // firma no le dice nada sobre su contenido.
  if (provided.length !== expected.length) {
    return undefined
  }

  if (!timingSafeEqual(provided, expected)) {
    return undefined
  }

  return payload
}
