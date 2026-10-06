/**
 * `GET /api/me/projects` → proyectos de la persona que preguntó, con su
 * estado (`in_progress` / `finished`).
 */

import { atender } from '../../back/dist/vercel.js'

export default {
  fetch(request: Request): Promise<Response> {
    return atender(request)
  },
}
