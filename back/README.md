# Sanatorio 42 — backend

Backend de [Sanatorio 42](https://github.com/patrilor/hackathon-peers): login con
la API de 42 y consulta de quién puede echarte un cable cuando te atascas con un
proyecto.

La idea es no preguntar a la API de 42 en cada visita. Cada petición del front se
responde desde **SQLite**, y por detrás un sincronizador va manteniendo la copia al
día. Así el front va rápido, la API de 42 no se satura, y si la API se cae
seguimos dando datos.

## Arranque rápido

```bash
npm install
cp .env.example .env        # y rellena FORTY_TWO_UID, FORTY_TWO_SECRET y SESSION_SECRET
npm run db:migrate          # crea data/sanatorio.db con el esquema
npm run dev                 # http://localhost:3000
```

Para generar una clave de sesión:

```bash
openssl rand -base64 48
```

### Scripts

| Script                            | Qué hace                                        |
| --------------------------------- | ----------------------------------------------- |
| `npm run dev`                     | Servidor con recarga en caliente (`tsx watch`). |
| `npm run build`                   | Compila a `dist/`.                              |
| `npm start`                       | Ejecuta lo compilado.                           |
| `npm run sync -- <login>`         | Sincroniza los datos de un usuario y sale.      |
| `npm run sync -- <login> --force` | Ignora los checkpoints y rehace todo.           |
| `npm run db:migrate`              | Aplica las migraciones pendientes.              |
| `npm test`                        | Suite completa (203 tests).                     |
| `npm run typecheck`               | `tsc --noEmit`.                                 |
| `npm run lint`                    | ESLint.                                         |
| `npm run format`                  | Prettier.                                       |

## Configuración

Todo va por variables de entorno; [`.env.example`](./.env.example) está comentado
variable por variable. Las que de verdad importan:

| Variable                             | Por qué                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| `FORTY_TWO_UID` / `FORTY_TWO_SECRET` | Credenciales de la app OAuth.                                                   |
| `FORTY_TWO_REDIRECT_URI`             | Callback. **Tiene que estar registrado carácter a carácter** en el panel de 42. |
| `FORTY_TWO_USER_AGENT`               | La API responde `403` a las peticiones sin `User-Agent`, y con el cuerpo vacío. |
| `SESSION_SECRET`                     | Firma las cookies. Mínimo 16 caracteres.                                        |
| `FRONTEND_ORIGINS`                   | Orígenes con CORS. Con credenciales **no** puede ser `*`.                       |
| `DATABASE_PATH`                      | Fichero SQLite. Se crea solo.                                                   |
| `CAMPUS_ID`                          | Madrid = `22`, Common Core = `21`.                                              |
| `SYNC_REQUESTS_PER_HOUR`             | Tope de peticiones a la API. Es el límite real de 42: pasarse da `429`.         |

### Scopes de la app OAuth

La app `78735` tiene `public`, y hace falta **`user`** también: sin él,
`/v2/me` devuelve `404` y no hay forma de saber quién está logueado. Pídelo en
<https://profile.intra.42.fr/oauth/applications/78735> y anota en
[`API_42.md`](./API_42.md) el día que se apruebe.

## API

El contrato con el front está en [`../docs/api.md`](../docs/api.md). En resumen:

| Método y ruta             | Qué hace                                     |
| ------------------------- | -------------------------------------------- |
| `GET /health`             | Sonda para UptimeRobot y para el despliegue. |
| `GET /auth/login`         | Empieza el login OAuth con PKCE.             |
| `GET /auth/callback`      | Cierra el login y pone la cookie de sesión.  |
| `GET /auth/me`            | Quién es el usuario de esta sesión.          |
| `POST /auth/logout`       | Destruye la sesión.                          |
| `GET /me/projects`        | Proyectos en curso.                          |
| `GET /me/availability`    | Si el usuario está disponible.               |
| `PUT /me/availability`    | Marca disponibilidad.                        |
| `GET /projects/:id/peers` | Quién más hay en el proyecto.                |

## Arquitectura

```
src/
├── api/          Cliente de la API de 42
│   ├── client.ts        Peticiones, paginación, reintentos, timeouts
│   ├── rate-limiter.ts  Ventanas deslizantes de minuto y hora
│   ├── token-manager.ts Client Credentials y token de usuario
│   └── errors.ts        Errores de la API, reintentables o no
├── auth/         OAuth y sesiones
│   ├── auth-service.ts    Login completo con PKCE y `state`
│   ├── oauth-client.ts    Authorization Code contra 42
│   ├── sessions.ts        Sesiones opacas en SQLite
│   └── signed-cookie.ts   Firma HMAC de las cookies
├── db/           SQLite: conexión, migraciones y repositorios
├── domain/       Tipos y errores que no dependen de nada
├── http/         Rutas, cookies y traducción de errores a HTTP
├── services/     Lógica de dominio: usuarios, proyectos, disponibilidad
├── sync/         Sincronizador, checkpoints y frescura
├── config/env.ts Validación del entorno con Zod
├── app.ts        Monta Fastify (lo usan tests, CLI y servidor)
└── server.ts     Arranque y apagado
```

La regla de oro: **`app.ts` no abre el puerto**. Devuelve la instancia de Fastify
montada y lista, así que los tests y el CLI usan exactamente el mismo grafo de
dependencias que producción. Si el servidor real y el testeado fueran distintos,
los tests no valdrían para nada.

### Login

Authorization Code con PKCE (`S256`), que es lo que pide la 42 para apps web:

1. `GET /auth/login` genera `state` y `code_verifier` con `crypto`, mete el estado
   en una cookie `__Host-` firmada y redirige a 42.
2. El usuario se autentica en 42 y vuelve a `/auth/callback`.
3. Se compara el `state` en tiempo constante, se canjea el código y se pide
   `/v2/me`.
4. Se crea una sesión opaca en SQLite. **El token de 42 no sale del servidor**: en
   la cookie va solo el id de sesión firmado.

Las dos cookies del callback (borrar el estado y poner la sesión) se mandan juntas
en un array: Fastify _reemplaza_ el `Set-Cookie` anterior en vez de añadirlo, así
que dos llamadas a `reply.header('Set-Cookie', …)` dejan solo la última y el
navegador se queda sin sesión.

### Sincronización

- Dos tokens: Client Credentials para catálogos, token de usuario para identidad.
- La API de 42 limita a 2 req/s y 1200 req/h. El limitador lleva ventanas
  deslizantes de minuto **y hora**; el tope por minuto solo no protege la cuota
  (100/min son 6000/h).
- Cada checkpoint guarda qué se sincronizó y cuándo, así que solo se vuelve a pedir
  lo caducado.
- Si el catálogo viene vacío no se destruye nada: se conserva lo que ya había.

### Fallos y caché

Si la API falla, los servicios devuelven lo que haya en SQLite y anotan el fallo.
La idea es que un fallo de 42 no se convierta en un fallo del back: mejor un dato
de hace dos minutos que una pantalla de error.

## Tests

```bash
npm test
```

203 tests: cliente, repositorios, servicios, sincronizador, sesiones y 25 tests de
integración de los siete endpoints contra un proveedor simulado de la API de 42.

Dos cosas que hacen que sean fiables:

- Los tests de integración arrancan la app en **SQLite en memoria**. Si se deja que
  `buildApp` abra `data/sanatorio.db`, todos los tests comparten estado y los
  fallos dependen del orden de ejecución.
- El proveedor baja el delay entre llamadas a 1 ms, para que la suite tarde medio
  segundo en vez de ocho. El retraso real lo cubren los tests del limitador con
  reloj falso.

## Despliegue

Decidido: **Oracle Cloud Always Free** (4 ARM, 24 GB) + **Caddy** como reverse proxy
con TLS automático + **UptimeRobot** contra `/health`. Alternativa si no hay
cuenta: Google Cloud e2-micro, que es más caro pero más fácil.

Detalles y pasos en [`../docs/backend-requirements.md`](../docs/backend-requirements.md).
