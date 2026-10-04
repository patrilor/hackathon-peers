# TODO — Backend de Sanatorio 42

Estado de cada bloque de trabajo. Se actualiza al terminar cada uno.

- `pending` — todavía sin empezar
- `working` — en curso
- `finish` — terminado, con tests en verde y subido a `back`

---

## 1. Reconciliar el entorno con el esquema de configuración `finish`

`back/.env` usa otro esquema de variables que el que espera `src/config/env.ts`.
Hoy la aplicación **no arrancaría**: faltan `FRONTEND_ORIGINS`,
`FORTY_TWO_REDIRECT_URI`, `SESSION_SECRET` y `FRONTEND_URL`.

- [x] Declarar en el esquema la base de la API y la URL de token, para poder
      apuntar a un servidor simulado en los tests.
- [x] Añadir `FORTY_TWO_USER_AGENT`: la API de 42 responde `403` sin `User-Agent`.
- [x] Generar `SESSION_SECRET` y completar las variables que faltan en `.env`.
- [x] Tests de que el esquema acepta y rechaza lo que debe.

## 2. Cliente de la API de 42 `finish`

- [x] Errores tipados (`ApiError` con status, endpoint y si es reintentable).
- [x] Caché de token de Client Credentials con margen de refresco y
      *single-flight* para no pedir diez tokens a la vez.
- [x] Rate limiter: mínimo de 550 ms entre llamadas y tope por minuto.
- [x] Reintentos con backoff exponencial, respetando la cabecera `Retry-After`.
- [x] Timeouts diferenciados: 30 s normal, 120 s para `locations`.
- [x] Paginación de `users`, `projects_users` y `locations`.
- [x] Endpoints tipados: `/v2/me`, `/users/:login/projects_users`,
      `/projects/:id/users`, `/campus/:id/locations`, `/campus/:id/users`.
- [x] Tests con `fetch` simulado: caché de token, 429, reintentos, timeout, paginación.

## 3. Servicios de dominio `working`

Mapeo exacto a `docs/api.md`. Aquí no se habla de SQLite ni de la API de 42.

- [ ] `getMyProjects(login)` → solo los proyectos en curso.
- [ ] `getPeers(projectId)` → participantes con `location` y `available`.
- [ ] `setMyAvailability(login, available)`.
- [ ] `getCurrentUser(login)` → `{ login, image }`.
- [ ] Traducción de errores internos a errores del contrato.
- [ ] Tests de cada servicio con repositorios en memoria.

## 4. Sincronizador `pending`

- [ ] Sincronización del campus (`locations`) con TTL de 60 s.
- [ ] Sincronización de los proyectos de un usuario con TTL de 900 s.
- [ ] Cache: bajo demanda si está caducado, fondo si no.
- [ ] Checkpoints en `sync_state` para no re-gastar los 1200 req/h.
- [ ] Que una caída de la API no rompa la lectura: se sirve lo cacheado.
- [ ] `sync-once` CLI paraforzar una sincronización.
- [ ] Tests con reloj falso y API simulada.

## 5. Autenticación OAuth `pending`

- [ ] `GET /auth/login` → redirección a 42 con `state` anti-CSRF.
- [ ] `GET /auth/callback` → canje del código, sesión y redirección al front.
- [ ] `GET /auth/me` → `{ login, image }`, `401` si no hay sesión.
- [ ] `POST /auth/logout` → borra la cookie.
- [ ] Cookie firmada con `SESSION_SECRET`, `httpOnly`, `sameSite=lax`, `secure`.
- [ ] Tests del ciclo completo con el proveedor de 42 simulado.

## 6. Servidor Fastify `pending`

- [ ] `buildApp()` que devuelva la instancia lista para tests.
- [ ] CORS con credenciales y lista de orígenes, nunca comodín.
- [ ] Cookies, manejo de errores y `404` en JSON.
- [ ] `GET /health` para UptimeRobot y para el despliegue.
- [ ] `server.ts` con arranque y apagado limpios.
- [ ] Tests de CORS: origen permitido, rechazado y preflight.

## 7. Tests de integración `pending`

- [ ] Servidor que simula la API de 42 (respuestas y errores reales).
- [ ] Los 7 endpoints del contrato contra ese servidor.
- [ ] Que `/projects/:id/peers` respects la regla de guardia.
- [ ] Que sin cookie `/auth/me` devuelva 401 y los protegidos 401 también.
- [ ] Boot de la app en `:memory:` para que los tests sean aislados.

## 8. Documentación `pending`

- [ ] `README.md` del back: arranque, scripts, variables, arquitectura.
- [ ] Actualizar `API_42.md` con la configuración real de la app (scopes, redirect).
- [ ] Dejar constancia del despliegue elegido (Oracle + Caddy + UptimeRobot).

## 9. Despliegue `pending`

Fuera del alcance del código: se hace cuando haya VM.

- [ ] `Dockerfile` y `.dockerignore`.
- [ ] Servicio systemd.
- [ ] Caddy como reverse proxy con HTTPS automático.
- [ ] UptimeRobot vigilando `/health` (evita que Oracle reclame la VM por ociosidad).
- [ ] Registrar `https://<dominio>/auth/callback` en el panel de 42.

---

## Notas

- Rama de trabajo: `back`. Nunca se hace push a `main`.
- Antes del PR final: `git merge main` para traer los cambios del front.
- La API limita a 2 req/s y 1200 req/h. `/campus/:id/locations` tarda
  cerca del minuto y revienta con un timeout de 30 s.
- `availability` es el único dato que no viene de 42: es nuestro.
- Regla de guardia: `available === true && location !== null`.