/**
 * Rutas de lectura: proyectos en curso y compañeros.
 *
 * Todas exigen sesión. Ninguna llama a la API de 42: se leen de la réplica
 * local, que es justo lo que hace que la web vaya rápida.
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
  /**
   * Sincroniza antes de leer, para no servir datos muy viejos.
   *
   * Es opcional para poder testear las rutas sin API. En producción se pasa.
   */
  refresh?: (login: string) => Promise<void>
}

export function registerDataRoutes(app: FastifyInstance, options: DataRoutesOptions) {
  const { auth, projects, availability } = options

  /**
   * Login de la petición, o 401.
   *
   * Se declara en cada ruta con `preHandler` en vez de un hook global: así las
   * rutas públicas (`/auth/*` y `/health`) no necesitan excepciones.
   */
  function requireSession(request: FastifyRequest): string {
    const cookie = readCookie(request.headers.cookie, SESSION_COOKIE_NAME)

    if (cookie === undefined) {
      throw new DomainError('unauthenticated', 'No hay sesión iniciada')
    }

    return auth.currentUser(cookie).login
  }

  /**
   * Refresca la réplica y luego lee.
   *
   * Si la sincronización falla, no se corta la petición: se sirve lo que haya
   * en la base, aunque sea viejo. Una web que cae cuando la 42 falla no vale
   * para nada, y los datos replicated de hace diez minutos siguen siendo
   * mejores que una pantalla de error.
   */
  async function fresh<T>(login: string, read: () => T): Promise<T> {
    try {
      await options.refresh?.(login)
    } catch {
      // A propósito sin log: el servidor ya avisa por stderr cuando un paso de
      // la sincronización falla. Aquí lo importante es no cortar la lectura.
    }

    return read()
  }

  /**
   * `GET /me/projects` → los proyectos en curso.
   *
   * Lista vacía si no hay datos: no es un error, es que aún no se ha sincronizado.
   */
  app.get('/me/projects', async (request, reply) => {
    const login = requireSession(request)
    const list = await fresh(login, () => projects.findInProgressByUser(login))

    return reply.send(list)
  })

  /**
   * `GET /projects/:id/peers` → quién puede ayudar.
   *
   * Excluye a quien pregunta: el front muestra gente con la que emparejarse.
   */
  app.get<{ Params: { id: string } }>('/projects/:id/peers', async (request, reply) => {
    const login = requireSession(request)

    // El id viene como texto y tiene que ser un entero: si no, `Number` daría
    // `NaN`, que se colaría en la consulta como un error raro de SQLite.
    const projectId = Number(request.params.id)

    if (!/^\d+$/.test(request.params.id)) {
      throw new DomainError('invalid_input', `El proyecto "${request.params.id}" no existe`)
    }

    const peers = await fresh(login, () => projects.findPeers(projectId, login))

    return reply.send(peers)
  })

  /** `PUT /me/availability` → marcarte como disponible. */
  app.put<{ Body: { available?: unknown } }>('/me/availability', async (request, reply) => {
    const login = requireSession(request)
    const result = availability.set(login, request.body.available)

    return reply.send(result)
  })

  /**
   * `GET /me/availability` → tu disponibilidad guardada.
   *
   * No estaba en `docs/api.md`. El front lo necesita para hidratar el toggle y
   * hoy lo resuelve con un `false` a ciegas; se añade al contrato en el paso de
   * documentación. Un 404 aquí sería peor: alguien recién llegado vería un error
   * por no haber tocado nunca el interruptor.
   */
  app.get('/me/availability', async (request, reply) => {
    const login = requireSession(request)

    return reply.send(availability.get(login))
  })
}
