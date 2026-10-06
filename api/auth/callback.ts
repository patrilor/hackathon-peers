/**
 * `GET /api/auth/callback` → el vuelta de OAuth: cambia el código por token y
 * crea la sesión.
 *
 * Es la URL que hay que dar de alta en el panel de la 42:
 * `https://<dominio>.vercel.app/api/auth/callback`.
 */

import { atender } from '../../back/dist/vercel.js'

export default {
  fetch(request: Request): Promise<Response> {
    return atender(request)
  },
}
