/**
 * Resolver el avatar de una persona a una URL.
 *
 * Vive en `domain/` y no en un repositorio porque no es un acceso a datos: es
 * una regla sobre la forma que tiene la API de 42. Cuando se eliminó la réplica
 * de personas, esta función se vino aquí para no perderla.
 */

import { AVATAR_SIZE_ORDER } from './types.js'
import type { ApiUserImage } from './types.js'

/**
 * Qué versión del avatar se guarda.
 *
 * La web enseña el avatar en dos sitios: en la cabecera, a 40 px, y en la lista
 * de compañeros, a 28 y 64 px. `medium` da de sobra para todo eso y pesa mucho
 * menos que el original, que puede ser una foto de móvil de varios megabytes.
 *
 * Los tamaños no están garantizados por la API, así que si `medium` no existe se
 * baja a `small` y de ahí al original, antes que devolver `null`.
 */
export function avatarUrlOf(image: ApiUserImage | null | undefined): string | null {
  if (image === null || image === undefined) {
    return null
  }

  const versions = image.versions

  if (versions !== null && versions !== undefined) {
    // Solo los tamaños, no el `link`: ese se mira aparte, y es de otra forma.
    for (const size of AVATAR_SIZE_ORDER) {
      if (size === 'link') {
        continue
      }

      const url = versions[size]

      // Se exige una cadena de verdad: la API manda `null` para los tamaños que
      // no ha generado, y a veces manda `""`. Ninguna de las dos es una URL.
      if (typeof url === 'string' && url !== '') {
        return url
      }
    }
  }

  // Último recurso: el original.
  return typeof image.link === 'string' && image.link !== '' ? image.link : null
}