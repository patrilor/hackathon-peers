# Contexto de trabajo — Backend de Sanatorio 42

Documento de traspaso. Resume **por qué** está el código como está y qué queda
pendiente, para no tener que redescubrirlo. Para el día a día, `TODO.md` lleva
el estado por bloques y `API_42.md` el detalle de la API de 42.

- Rama de trabajo: `back`. Nunca se hace push a `main`.
- Antes del PR final: `git merge main` para traer los cambios del front.

---

## Dónde se quedó todo

Los bloques 1–8 de `TODO.md` están terminados, con tests en verde y subidos a
`back`. El bloque 9 (despliegue) está pendiente y no depende de código.

Lo último que se hizo fue un **refactor de las ubicaciones**: pasó de un
snapshot masivo del campus a un atributo de cada persona. Abajo está el detalle,
porque es el cambio con más consecuencias de todo el backend.

## Comandos

```bash
npm ci          # instalar (primera vez)
npm run dev     # servidor en http://localhost:3000 con recarga
npm test        # vitest
npm run typecheck
npm run lint
npm run build
npm run migrate # crear/actualizar la base
npm run sync    # sincronizar con la API de 42
```

Todos leen `.env` (copiar de `.env.example`). Ese fichero no se sube.

## Cómo se prueba contra la API real

1. `npm run dev`.
2. Abrir `http://localhost:5173` con el front en modo real
   (`VITE_USE_MOCK=false`, `VITE_API_URL=http://localhost:3000`).
3. Login por OAuth contra el callback local
   `http://localhost:3000/auth/callback`, que ya está registrado en el panel.

`.env.example` trae los valores que funcionan en local, y el login de prueba se
hace en el navegador a mano: **no** se automatiza con credenciales.

---

## El refactor de ubicaciones

### Qué se descartó y por qué

El endpoint natural era `GET /v2/campus/:id/locations`. Se descartó:

- Devuelve `X-Total: 751 077` para Madrid, o sea **7 511 páginas** de 100.
- No es el estado actual sino el **histórico** de todos los puestos desde
  siempre, y no admite filtro para quedarse con las vigentes:
  `filter[end_at]=nil` responde `422`.
- A 550 ms por petición son unas **69 minutos** de reloj, y contra la cuota de
  1200 req/h serían **más de seis horas**: el sincronizador no terminaría nunca.

No era un endpoint lento, era inviable. Por el camino se cayó también el
timeout especial de 120 s (`API_TIMEOUT_HEAVY_MS`), que ya no tenía sentido.

### Qué se usa en su lugar

El campo `location` del propio objeto de usuario. Se comprobó empíricamente que
viene en **las dos fuentes**:

| Fuente | Trae `location` |
|---|---|
| `GET /v2/users/:login` | sí, siempre |
| `GET /v2/projects/:id/users` (participantes) | **sí, en todos** |

Lo segundo es lo que hace viable el asunto: al sincronizar los participantes de
un proyecto, la ubicación de 2.042 personas llega **en la misma respuesta, sin
una petición extra por persona**. No hace falta ningún `GET /users/:login` por
participante, que es lo que se llegó a plantear.

`GET /v2/campus/:id/users` se conserva en el cliente pero no se usa: no trae
ubicación, solo sirve para descubrir personas.

### Dónde vive

Migración v3, `ubicaciones-en-usuarios`:

- `users.current_location` — puesto en el cluster, o `null`.
- `users.location_synced_at` — cuándo se observó.
- Se **elimina** la tabla `user_locations`.

El repositorio de ubicaciones (`db/repositories/locations.ts`), el checkpoint
`sync:campus:*:locations`, la regla de frescura `campusLocations` y el
`campusId` que se arrastraba por app, container, servicios, CLI y tests se
eliminaron con él.

### El matiz que hay que respetar

`undefined` y `null` **no** son lo mismo, y es lo que sostiene el diseño:

| Lo que trae la API | Significa | Qué hace el `upsert` |
|---|---|---|
| `"c2r17s2"` | Está en ese puesto | Sobrescribe |
| `null` | La API lo dice y no está en el campus | **Borra** la ubicación |
| ausente (`undefined`) | Este endpoint no habla de ubicaciones | **No toca** nada |

Los resúmenes de usuario de `projects_users` no traen `location`. Si se trataran
como `null`, todo el mundo aparecería fuera del campus en cuanto se sincronizara
cualquier proyecto.

### Las ubicaciones caducan

`location_synced_at` no es decorativo: `findPeers()` solo entrega una ubicación
si es más reciente de `LOCATION_MAX_AGE_MS` (30 minutos, en `domain/types.ts`).
Pasado ese tiempo se entrega como `null`, porque un puesto del cluster es
información que envejece en cuanto alguien se levanta, y es preferible no
afirmarlo antes que mentir.

El margen de 30 minutos es holgado a propósito: los participantes se refrescan
como mucho cada 15 minutos (`FRESHNESS.projectParticipants`), así que un puesto
solo se da por perdido si de verdad dejamos de mirar.

El corte se compara **como texto** en SQL. Funciona porque todas las marcas se
guardan con `nowIso()`, que es ISO-8601 UTC siempre; si algún día se mezclaran
formatos, esa comparación sería el primer sitio que se rompería.

---

## Front conectado a la API real

El usuario autorizó tocar el front. El modo mock se conserva intacto
(`front/src/api/mock.js` no se modifica); `front/src/api/index.js` sigue eligiendo
con `VITE_USE_MOCK`.

Dos cosas estaban rotas contra la API real:

- `AvailabilityToggle` leía la disponibilidad en el inicializador de `useState`.
  Con el mock funciona (devuelve un booleano), contra la API real devuelve una
  `Promise`, que además es *truthy*: la casilla salía siempre marcada. Ahora
  hidrata en un `useEffect`, con `Promise.resolve()` delante para que el mismo
  código sirva para el mock síncrono y la API real asíncrona.
- `realApi` no tenía `getAvailability`. Ahora existe y **desenvuelve** la
  respuesta: el back devuelve `AvailabilityResponse` (`{ available: boolean }`),
  y lo que consume el componente es un booleano.

`front/.env` (ignorado por git) es lo que hace que el front hable con el back
local. Sin él, Vite compila sin dirección de API a la que preguntar.

---

## El filtro solo-Madrid

El usuario pidió que la web solo muestre gente de 42 Madrid. La API manda a
todo el mundo y la persona embebida en cada `projects_users` **no trae campus**
(se comprobó: el campo no existe en `user`), así que no se puede filtrar con un
`filter[campus_id]` ni leyendo el estudiante en el acto.

### Cómo se filtra entonces

Con un directorio del campus: el listado de `GET /v2/campus/:id/users` (el
"members list" del campus), que con el scope `public` responde sin token de
usuario. Sus logins son la única fuente de "quién es de aquí".

- Un script lo baja una vez y lo guarda en la caché con la clave
  `campus_directory:<id>`: `npm run madrid:seed` (`make madrid`). Son decenas de
  páginas a 2 req/s (10-20 s en Madrid), por eso se hace una sola vez y dura
  `CAMPUS_DIRECTORY_TTL_SECONDS` (12 h).
- El filtro se aplica **dos veces de verdad**:
  1. al **guardar** cada página de peers (`trimPage` ya solo persiste a los de
     Madrid), y
  2. al **leer** (`everyone.filter(esDeMadrid)`), para que una página cacheada
     antes del filtro no se cuele aunque el despliegue se hiciera mal en el
     orden correcto es cinturón y tirantes.
- `totalParticipants` ya **no** es el `X-Total` de la API: ahora es cuántos del
  campus hay entre las páginas que tenemos en caché. `complete`/`X-Partial`
  sigue diciendo si faltan páginas por bajar. Es un cambio de contrato
  (`docs/api.md`) que aún hay que contar al equipo.

### Decisión: fallar cerrado, no abierto

**Sin directorio sembrado, `/projects/:id/peers` responde 500 con aviso**
(no filtrar colaría gente de otros campus). El error dice que se siembre con
`npm run madrid:seed`. No hay fallback a "lo que haya": el peor caso para el
plan es servir a quien no es de Madrid.

### El directorio caducado sigue valiendo

La lectura usa `cache.get` y, si caducó, `getStale`: un directorio de hace unas
horas filtra igual que uno recién bajado. Mejor uno viejo que ninguno. Solo se
deja de filtrar si no hay directorio en absoluto (el 500 de arriba).

### Cómo se limpia y se reconstruye

El orden importa: **primero se despliega el filtro**, y **después** se vacía lo
viejo. Si se vacía antes del despliegue, la caché se repuebla con el mundo
entero.

```bash
make flush-cache   # o: npm run cache:flush — borra TODA la caché
make madrid        # o: npm run madrid:seed — siembra el directorio
```

`cache:flush` (distinto de `cache:purge`, que solo borra lo caducado) hace
`DELETE FROM cache` y **conserva `availability`**: la próxima vez que alguien
abra un proyecto, las páginas se bajan ya solo-Madrid. En producción (Turso),
si no hay acceso, vale `turso db shell <bd> "DELETE FROM cache;"`.

### Variables nuevas

- `CAMPUS_ID` — campus al que se limita (22 = Madrid, default).
- `CAMPUS_DIRECTORY_TTL_SECONDS` — caducidad del directorio (12 h, default).

---

## Estado verificado

- Backend: typecheck limpio, lint limpio, build correcto, **183 tests en verde**
  (9 ficheros).
- Front: `npm run build` correcto.
- Local contra la API real, con la sesión de `albrodri`:
  - `/health` → 200
  - `/auth/me` → `{"login":"albrodri","image":null}`
  - `/me/availability` → `{"available":true}`
  - `/me/projects` → `2689 Call Me Maybe`, `2705 Fly-in`
  - `/projects/2689/peers` → 2.041 peers, con ubicación y sin ella, y **sin
    ningún `undefined`** en el campo

## Cosas que se supieron por el camino

- La primera llamada a `/me/projects` tras un rato puede tardar **bastante**: el
  sincronizador pide los participantes de cada proyecto en curso, y el de
  `2689` son 2.042 personas ≈ 21 páginas. Después va al instante por checkpoint.
  Con `LOGGER=false` (`LOGGER` en `.env`) no se ve nada del progreso, y el front
  solo ve un spinner. Si molesta, la salida es un sync en segundo plano.
- El perfil de OAuth (`scope profile`) quedó confirmado: el callback local
  completa el intercambio y crea sesión. Antes estaba en duda.
- El mock de `getAvailability` y el de la API real devuelven cosas distintas
  (booleano frente a `Promise`). Es una fuente clásica de bugs al cambiar de
  modo; por eso el `useEffect` usa `Promise.resolve()`.

## Pendiente

- [ ] Contar al equipo (y reflejar en `docs/api.md`) que `X-Total-Participants`
      ahora son solo los del campus, no el total global de la API.
- [ ] **Bloque 9 de `TODO.md`**: `Dockerfile`, `.dockerignore`, servicio
      systemd, Caddy con HTTPS, UptimeRobot contra `/health` y registrar
      `https://<dominio>/auth/callback`. Bloqueado hasta tener VM de Oracle ARM y
      dominio.
- [ ] Validar `FORTY_TWO_REDIRECT_URI` contra `oauthRedirectOrigin` para
      impedir que un callback de Vercel se cuele en el entorno equivocado.
- [ ] Estados de carga y de error en el front: con la API real hay esperas
      largas y fallos, y ahora mismo no se explican.
- [ ] Front: mensaje amable si la persona no tiene proyectos en curso.

## Notas

- La API de 42 limita a 2 req/s y 1200 req/h. `API_REQUEST_DELAY_SECONDS=0.55`
  es 1,8 req/s, dentro del límite pero sin margen para ráfagas.
- `availability` es el único dato que no viene de 42: es nuestro, y por eso no
  se borra cuando alguien sale del campus.
- Regla de guardia: `available === true && location !== null`. Vive en
  `front/src/components/PeerList.jsx` (`onDuty`).