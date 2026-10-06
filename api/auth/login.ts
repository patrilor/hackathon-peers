/**
 * `GET /api/auth/login` → empieza el OAuth con la 42.
 *
 * Fichero de Vercel: un fichero en `api/` es una función, y la ruta la marca
 * el nombre. Todo lo que hace es pasarle la petición a la app Fastify
 * (`back/dist/vercel.js`), que es la que monta el redirect y las cookies.
 */

import { atender } from '../../back/dist/vercel.js'

export default {
  fetch(request: Request): Promise<Response> {
    return atender(request)
  },
}
