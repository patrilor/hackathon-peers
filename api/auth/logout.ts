/**
 * `POST /api/auth/logout` → borra la sesión y su cookie.
 */

import { atender } from '../../back/dist/vercel.js'

export default {
  fetch(request: Request): Promise<Response> {
    return atender(request)
  },
}
