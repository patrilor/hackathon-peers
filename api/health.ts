/**
 * `GET /api/health` → el equivalente en Vercel del `/health` local.
 *
 * Sirve para que un monitor pueda comprobar que la instancia arranca y la
 * base responde sin tener que abrir una sesión.
 */

import { atender } from '../back/dist/vercel.js'

export default {
  fetch(request: Request): Promise<Response> {
    return atender(request)
  },
}