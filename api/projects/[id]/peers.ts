/**
 * `GET /api/projects/:id/peers` → quién te puede atender en ese proyecto.
 *
 * El `[id]` de la carpeta es el segmento dinámico de Vercel (una carpeta entre
 * corchetes casa con cualquier valor de esa posición). El id no se lee de
 * aquí: Fastify lo saca de la ruta, que el puente reconstruye desde
 * `request.url` quitando el prefijo `/api`.
 *
 * No se usa un *catch-all* (`api/[...path].ts`) a propósito: en un proyecto
 * sin Next.js Vercel no lo soporta, mientras que los segmentos dinámicos
 * sí.
 */

import { atender } from '../../../back/dist/vercel.js'

export default {
  fetch(request: Request): Promise<Response> {
    return atender(request)
  },
}
