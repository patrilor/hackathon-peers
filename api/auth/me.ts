/**
 * `GET /api/auth/me` → el perfil de quien tenga la sesión abierta (401 si no
 * hay nadie dentro).
 *
 * Es la primera llamada que hace el front al arrancar.
 */

import { atender } from '../../back/dist/vercel.js'

export default {
  fetch(request: Request): Promise<Response> {
    return atender(request)
  },
}
