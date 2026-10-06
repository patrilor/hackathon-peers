/**
 * `GET /api/me/availability` y `PUT /api/me/availability` → si está de
 * guardia y si lo quiere cambiar.
 *
 * Un mismo fichero para los dos verbos: con `fetch` se atiende cualquier
 * método y Fastify ya decide dentro de la ruta qué hace cada uno.
 *
 * Es el endpoint con cuerpo (`PUT`), el que obliga a que el puente pase el
 * payload a Fastify en vez de depender de leerlo del stream, que en Vercel ya
 * lo ha consumido el runtime.
 */

import { atender } from '../../back/dist/vercel.js'

export default {
  fetch(request: Request): Promise<Response> {
    return atender(request)
  },
}
