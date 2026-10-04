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
      _single-flight_ para no pedir diez tokens a la vez.
- [x] Rate limiter: mínimo de 550 ms entre llamadas y tope por minuto.
- [x] Reintentos con backoff exponencial, respetando la cabecera `Retry-After`.
- [x] Timeouts diferenciados: 30 s normal, 120 s para `locations`.
- [x] Paginación de `users`, `projects_users` y `locations`.
- [x] Endpoints tipados: `/v2/me`, `/users/:login/projects_users`,
      `/projects/:id/users`, `/campus/:id/locations`, `/campus/:id/users`.
- [x] Tests con `fetch` simulado: caché de token, 429, reintentos, timeout, paginación.

## 3. Servicios de dominio `finish`

Mapeo exacto a `docs/api.md`. Aquí no se habla de SQLite ni de la API de 42.

- [x] `getMyProjects(login)` → solo los proyectos en curso.
- [x] `getPeers(projectId)` → participantes con `location` y `available`.
- [x] `setMyAvailability(login, available)`.
- [x] `getCurrentUser(login)` → `{ login, image }`.
- [x] Traducción de errores internos a errores del contrato.
- [x] Tests de cada servicio con repositorios en memoria.

## 4. Sincronizador `finish`

Estrategia decidida por el presupuesto, no por las ganas de datos frescos:
1200 req/h no dan para recorrer un campus entero.

- [x] Globales: catálogo de proyectos y ubicaciones del campus, 2 llamadas.
- [x] Bajo demanda: proyectos de quien entra y participantes de los proyectos
      que tiene en curso.
- [x] Frescura con dos fuerzas, en vez de un TTL fijo:
  - ubicaciones 10 min (la llamada tarda ~1 min, refrescarla antes es tonto),
  - catálogo 6 h (cambia poquísimo),
  - proyectos de la persona 5 min, participantes 2 min.
  - `maxStalenessMs` aparte, para que un dato no se quede viejo para siempre.
- [x] Checkpoints en `sync_state`. Solo se marcan si el paso terminó bien: un
      fallo deja la marca vieja y la siguiente vuelta lo reintenta.
- [x] Un 401 aborta la vuelta; un 500 se registra y se sigue con lo demás.
- [x] Catálogo vacío o desconocido: no se acepta y no se pisa lo que hay.
- [x] `npm run sync -- <login>` y `npm run sync -- --force`.
- [x] Tests con reloj falso y doble de la API (26 tests).

Bug encontrado por los tests y corregido: una pertenencia a un proyecto
desconocido reventaba la transacción y se perdían **todos** los proyectos de
esa persona. Ahora se salta solo esa entrada.

## 5. Autenticación OAuth `finish`

- [x] Authorization code flow con PKCE (S256). El verifier nunca va en la URL.
- [x] `state` anti-CSRF en cookie firmada y compara en tiempo constante.
- [x] Canje del código con Basic auth y `code_verifier`.
- [x] Sesiones en SQLite (migración v2), no en la cookie: la cookie lleva un
      identificador opaco y firmado, y el token de 42 no viaja en cada petición.
- [x] La sesión nunca vive más que el token: `min(expires_in, 12 h)`.
- [x] Logout que borra la fila, no solo la cookie.
- [x] Sesiones caducadas borradas al leerlas y con purga explícita.
- [x] Un 404 en `/v2/me` explica que falta aprobar el scope `user`, que es el
      fallo más caro de diagnosticar porque la API responde `{}` y no dice nada.
- [x] 26 tests del ciclo entero con proveedor de 42 simulado y reloj falso.

PENDIENTE FUERA DEL CÓDIGO: el panel de la app `78735` sigue con `public` y
`profile`. `profile` no existe en 42; tiene que ser `user`. Hasta que se
apruebe, el login contra la API real no se puede probar.

## 6. Servidor Fastify `finish`

- [x] `buildApp()` que devuelva la instancia lista para tests.
- [x] CORS con credenciales y lista de orígenes, nunca comodín.
- [x] Cookies, manejo de errores y `404` en JSON.
- [x] `GET /health` para UptimeRobot y para el despliegue.
- [x] `server.ts` con arranque y apagado limpios.
- [x] Tests de CORS: origen permitido, rechazado y preflight.

Nota: en el callback de OAuth hay que mandar **dos** cookies a la vez (borrar el
estado y poner la sesión). Fastify **reemplaza** el `Set-Cookie` anterior en vez de
añadirlo, así que se recogen en un array y se mandan juntas (`setCookies`).
Mandar dos llamadas a `reply.header('Set-Cookie', …)` deja solo la última, y el
navegador se queda sin sesión.

## 7. Tests de integración `finish`

- [x] Servidor que simula la API de 42 (respuestas y errores reales).
- [x] Los 7 endpoints del contrato contra ese servidor.
- [x] Que `/projects/:id/peers` respecte la regla de guardia.
- [x] Que sin cookie `/auth/me` devuelva 401 y los protegidos 401 también.
- [x] Boot de la app en `:memory:` para que los tests sean aislados.

Dos trampas que costaron una vuelta de tuerca, por si se repiten:

- `inject().json()` devuelve `any`. El helper `json()` de `tests/helpers/test-app.ts`
  lo parsea a `unknown` y cada test hace su propio cast, que es donde está el tipo.
- El proveedor de la API usa `API_REQUEST_DELAY_SECONDS=0.001` en los tests. Con
  los 550 ms reales, la suite tardaba 8 s; ahora tarda medio segundo. Los tests del
  limitador cubren el retraso de verdad con reloj falso.

## 8. Documentación `finish`

- [x] `README.md` del back: arranque, scripts, variables, arquitectura.
- [x] Actualizar `API_42.md` con la configuración real de la app (scopes, redirect).
- [x] Dejar constancia del despliegue elegido (Oracle + Caddy + UptimeRobot).

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
