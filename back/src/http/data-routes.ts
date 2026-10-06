/**
 * Rutas de lectura: proyectos en curso, compañeros y disponibilidad.
 *
 * Todas exigen sesión. Ninguna llama directamente a la API de 42: leen de la
 * caché, y solo van a la API cuando todavía no hay lo que necesitan, siempre
 * con un presupuesto acotado.
 *
 * Esa diferencia con la versión anterior es el motivo de que estas rutas ya no
 * necesitan sincronizar antes de leer. Antes cada visita a la lista de compañeros
 * esperaba a una réplica completa del proyecto, que con el proyecto 2689 (2 047
 * participantes) y el límite de 2 peticiones por segundo eran más de 10 s. Si la
 * 42 contestaba `503`, la web se caía. Ahora la respuesta sale de la caché en
 * milisegundos y, si falta algo, se rellena un poco por visita.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify'

import { DomainError } from '../domain/errors.js'
import type { AuthService } from '../auth/auth-service.js'
import type { ProjectsService } from '../services/projects.js'
import type { AvailabilityService } from '../services/availability.js'
import { readCookie, SESSION_COOKIE_NAME } from './cookies.js'

export type DataRoutesOptions = {
  auth: AuthService
  projects: ProjectsService
  availability: AvailabilityService
}

export function registerDataRoutes(app: FastifyInstance, options: DataRoutesOptions) {
  const { auth, projects, availability } = options

  /**
   * Login de la petición, o 401.
   *
   * Se declara en cada ruta con `requireSession` en vez de con un hook global:
   * así las rutas públicas (`/auth/*` y `/health`) no necesitan excepciones.
   */
  function requireSession(request: FastifyRequest): string {
    const cookie = readCookie(request.headers.cookie, SESSION_COOKIE_NAME)

    if (cookie === undefined) {
      throw new DomainError('unauthenticated', 'No hay sesión iniciada')
    }

    return auth.currentUser(cookie).login
  }

  /**
   * `GET /me/projects` → los proyectos en curso.
   *
   * Lista vacía si no tiene ninguno: no es un error, es que no le toca.
   */
  app.get('/me/projects', async (request, reply) => {
    const login = requireSession(request)

    return reply.send(await projects.findInProgressByUser(login))
  })

  /**
   * `GET /projects/:id/peers` → quién puede ayudar.
   *
   * Devuelve solo los accionables (de guardia o en curso) y el resto va en
   * cabeceras, porque mandarle 2 047 personas al navegador para que dibuje 60 no
   * tiene sentido:
   *
   * | Cabecera              | Qué es                                              |
   * |-----------------------|-----------------------------------------------------|
   * | `X-Total-Participants`| Participantes totales del proyecto en 42.            |
   * | `X-Peers-Returned`    | Cuántos vienen en esta respuesta.                   |
   * | `X-Partial`           | `true` si aún faltan páginas por bajar.             |
   *
   * `X-Partial` importa: un proyecto grande tarda varias visitas en completarse,
   * porque la API va a 2 peticiones por segundo y bajarlo entero no cabe en una
   * función de Vercel (ver `services/projects.ts`). El front lo usa para reintentar
   * solo y preguntar cuándo va a haber más gente.
   */
  app.get<{ Params: { id: string } }>('/projects/:id/peers', async (request, reply) => {
    const login = requireSession(request)

    // El id viene como texto y tiene que ser un entero: sin esta comprobación,
    // `Number` devolvería `NaN` y acabaría en una consulta a la API.
    if (!/^\d+$/.test(request.params.id)) {
      throw new DomainError('invalid_input', `El proyecto "${request.params.id}" no existe`)
    }

    const result = await projects.findPeers(Number(request.params.id), login)

    reply.header('X-Total-Participants', String(result.totalParticipants))
    reply.header('X-Peers-Returned', String(result.peers.length))
    reply.header('X-Partial', result.complete ? 'false' : 'true')
    // La respuesta depende de quién pregunta y de quién está de guardia, así que
    // no puede cachear en ningún intermediario. `Cache-Control` y no `Vary`: `Vary` lo
    // usa ya el hook de CORS con `Origin`, y sobrescribirlo quitaría el origen de
    // la lista de variación.
    reply.header('Cache-Control', 'private, no-store')

    return reply.send(result.peers)
  })

  /**
   * `PUT /me/availability` → marcarte como disponible.
   *
   * No toca la API de 42: "de guardia" es un dato nuestro, no existe en 42.
   */
  app.put<{ Body: { available?: unknown } }>('/me/availability', async (request, reply) => {
    const login = requireSession(request)

    return reply.send(await availability.set(login, request.body.available))
  })

  /**
   * `GET /me/availability` → tu disponibilidad guardada.
   *
   * No estaba en `docs/api.md`, pero el front lo necesita para hidratar el
   * interruptor de guardia; sin él empieza en `false` a ciegas y no se sabe si
   * estás guardado como disponible o no. Devolver `false` es mejor que un 404:
   * quien acaba de llegar y no ha tocado nada no ha hecho nada malo.
   */
  app.get('/me/availability', async (request, reply) => {
    const login = requireSession(request)

    return reply.send(await availability.get(login))
  })
}