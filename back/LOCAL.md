# Ejecutar el backend en local

Documento de operación: qué hace falta instalar, cómo se levanta, cómo se
comprueba que funciona y qué hacer cuando algo falla. Para el porqué de cada
decisión está [`README.md`](README.md), y para el detalle de la API de 42,
[`API_42.md`](API_42.md).

## 0. Lo rápido

Hay un `Makefile` con todo esto. Si quieres lo mínimo:

```bash
cd back
make up      # instala, crea el .env si falta, migra y arranca en el 3000
```

En otra terminal, para tener datos:

```bash
make sync    # replica la 42 en local (tarda varios minutos la primera vez)
make data    # dice qué se ha replicado
make session # cookie de prueba para curl, sin navegador
make madrid  # siembra el directorio del campus (solo pasarán de Madrid)
make check   # typecheck + lint + tests + build
```

`make help` lista los 20 objetivos. El resto del documento explica qué hace cada
paso y por qué, por si hay que hacerlo a mano o algo falla.

## 1. Requisitos

| Herramienta | Versión | Notas |
| ----------- | ------- | ----- |
| Node.js | **22 o superior** | `package.json` lo exige con `engines`. El 22 ya trae `node --env-file`, que es como se cargan las variables sin `dotenv`. |
| npm | 10 o superior | Viene con Node 22. |
| `openssl` | cualquiera | Solo para generar `SESSION_SECRET`. |

```bash
node -v   # debe salir v22.x o superior
npm -v
```

No hace falta nada más: la base de datos es un fichero SQLite que crea el
propio backend, y no hay contenedores ni servicios externos.

### `better-sqlite3` y los binarios nativos

`better-sqlite3` trae un binario precompilado, así que `npm ci` normalmente no
compila nada. Si aparece un error de compilación al instalar, casi siempre es
falta de las herramientas de construcción de C:

```bash
# Debian / Ubuntu
sudo apt-get install -y build-essential python3
```

## 2. Puesta en marcha

Cuatro comandos, en este orden. En `make` salen resumidos en `make up`:

```bash
cd back

# 1. Dependencias
npm ci

# 2. Configuración: crea .env a partir de la plantilla
cp .env.example .env

# 3. Esquema de la base de datos
npm run db:migrate

# 4. Servidor con recarga en caliente
npm run dev
```

`npm run dev` imprime `escuchando en 0.0.0.0:3000`. A partir de ahí el backend
responde en <http://localhost:3000>.

### Rellenar el `.env`

Las seis variables de la tabla de abajo **no tienen valor por defecto**: si falta
alguna, el servidor se niega a arrancar con un error que dice cuál. El resto sí
tienen default y se puede dejar como está.

```bash
openssl rand -base64 48   # para SESSION_SECRET
```

| Variable | Obligatoria | Qué poner |
| -------- | ----------- | --------- |
| `FORTY_TWO_UID` | sí | Client ID de tu app OAuth. Está en <https://profile.intra.42.fr/oauth/applications> |
| `FORTY_TWO_SECRET` | sí | El secret de esa misma app. **No se sube a git** |
| `FRONTEND_ORIGINS` | sí | `http://localhost:5173` si vas a usar el front de Vite |
| `FORTY_TWO_REDIRECT_URI` | sí | `http://localhost:3000/auth/callback`. **Tiene que estar registrada carácter a carácter** en el panel de 42 |
| `SESSION_SECRET` | sí | La que acabas de generar con `openssl`, mínimo 16 caracteres |
| `FRONTEND_URL` | sí | `http://localhost:5173`, a dónde vuelve el usuario tras login |

El `.env` está en `.gitignore` a propósito, junto con `data/`. Se puede
comprobar con:

```bash
git check-ignore -v back/.env back/data/sanatorio.db
```

### Los dos valores que más confunden

- **`FORTY_TWO_USER_AGENT`** tiene default, pero no se debe borrar. La API de 42
  responde `403` con el **cuerpo vacío** a las peticiones sin `User-Agent`, así
  que el error es casi imposible de diagnosticar si no se sabe esto.
- **`FRONTEND_ORIGINS`** no admite `*`. CORS con credenciales es incompatible con
  el comodín: si se pone `*`, el login parece funcionar pero `/auth/me` devuelve
  `401` siempre, porque el navegador no manda la cookie de sesión.

## 3. Probar que funciona

```bash
curl -s http://localhost:3000/health
# {"status":"ok"}
```

Eso solo comprueba que el proceso está vivo. Para ver datos de verdad hacen falta
sesión, y la sesión se fabrica con el login OAuth, así que hay dos formas.

### Opción A: el login real (lo que se usa de verdad)

Arranca el front y entra por el botón de login:

```bash
cd front
cp .env.example .env      # ponle VITE_USE_MOCK=false
npm ci
npm run dev
```

Con `VITE_USE_MOCK=false` y `VITE_API_URL=http://localhost:3000` el front llama
al back real. El login abre 42 en el navegador, se autentica y vuelve a
`/auth/callback`. Este camino no se puede automatizar: necesita credenciales de
una cuenta de 42.

### Opción B: probar las rutas de datos sin navegador

Para ver las rutas sin pasar por OAuth se puede crear una sesión directamente en
SQLite, firmada con el `SESSION_SECRET` del `.env`:

```bash
make session
```

Imprime la línea para exportar y tres `curl` listos para pegar:

```
  Sesión falsa creada para albrodri.

  export COOKIE="__Host-sanatorio_session=id.firma"

  curl -s -H "Cookie: $COOKIE" http://localhost:3000/auth/me
  ...
```

Con la cookie ya exportada:

```bash
COOKIE='__Host-sanatorio_session=...'

curl -s -H "Cookie: $COOKIE" http://localhost:3000/auth/me
# {"login":"albrodri","image":"https://cdn.intra.42.fr/users/.../medium_albrodri.gif"}

curl -s -H "Cookie: $COOKIE" http://localhost:3000/me/projects
# [{"id":2689,"name":"Call Me Maybe"},{"id":2705,"name":"Fly-in"}]

curl -s -H "Cookie: $COOKIE" http://localhost:3000/projects/2689/peers | head -c 400
# {"login":"aabdou","image":"https://cdn.intra.42.fr/...","location":null,
#  "available":false,"status":"in_progress"}, ...

curl -s -H "Cookie: $COOKIE" http://localhost:3000/projects/999999/peers
# 404 {"error":"not_found","message":"El proyecto 999999 no está en la réplica local"}
```

Dos detalles que hacen que este script funcione y que no son obvios:

- `expires_at` está en **milisegundos**, no en segundos. Es un entero de SQLite y
  se compara contra `Date.now()`.
- La cookie va firmada con HMAC-SHA256 en base64url y con el formato
  `valor.firma`, sin `=` al final. Si el formato no cuadra, el servidor responde
  `401 unauthenticated` sin dar más pistas.

Estas sesiones son de mentira y hay que borrarlas cuando ya no hagan falta:

```bash
make clean-sessions
```

## 4. Cargar datos de verdad

Un backend recién migrado tiene la base vacía, así que las rutas de lectura
devuelven listas vacías hasta que el sincronizador ha llamado a la API de 42. Para
llenarla:

```bash
# Solo el catálogo global de proyectos (18 peticiones)
npm run sync

# Los proyectos de una persona y los participantes de los que tiene en curso
npm run sync -- albrodri
```

Cada línea dice el paso, cuántos elementos trae y cuánto tardó:

```
projects_catalog: updated | 1702 elementos | 103626 ms
user_projects: updated | 40 elementos | 755 ms
project_participants: updated | 2047 elementos | 66640 ms
```

**Tarda, y es normal.** El catálogo son 1 702 proyectos y cada proyecto en curso
son miles de participantes: el proyecto 2689 son 2 047 personas en 21 peticiones
a 550 ms. La primera vuelta de una persona con dos proyectos en curso se acerca
a los tres minutos. No es un cuelgue.

`npm run sync` respeta los checkpoints, así que una segunda vez seguido no hace
nada. Para rehacerlo todo:

```bash
npm run sync -- albrodri --force
```

### El directorio del campus (solo-Madrid)

Para que la lista de compañeros solo muestre gente de 42 Madrid hace falta un
directorio del campus: el listado de `GET /v2/campus/:id/users` («members
list»), sin el cual no se sabe quién es de aquí. Se baja una sola vez y se
cachea:

```bash
make madrid     # o npm run madrid:seed — baja el directorio (10-20 s) y lo cachea 12 h
```

**Sin directorio sembrado, `/projects/:id/peers` responde 500 con aviso**, de
propósito: no filtrar colaría gente de otros campuses. El error dice qué
comando hay que lanzar. Un directorio caducado sigue filtrando igualmente
(mejor uno de hace horas que ninguno).

Si las reglas cambian (el caso que ya hemos vivido: desplegar el filtro cuando
las páginas guardadas traían a todo el mundo), el orden es **desplegar primero y
vaciar después**:

```bash
make flush-cache    # o npm run cache:flush — borra TODA la caché, conserva availability
make madrid         # se vuelve a sembrar el directorio
```

`make reset` también deja la caché vacía (borra `data/` entero), pero se lleva
por delante `availability`; `make flush-cache` solo toca la tabla de caché.

### Ver qué hay dentro

```bash
make data
```

```
  proyectos       1702
  personas        2295
  con avatar      2291
  en el campus     366
  en proyectos    4175

  estado por proyecto:
    2705   Fly-in                   finished               1476
    2689   Call Me Maybe            finished               1433
    2705   Fly-in                   in_progress             635
    2689   Call Me Maybe            in_progress             593
```

Los números exactos cambian según lo que se haya sincronizado; lo que importa es
que no sean cero. Para consultar a mano, la base es un fichero SQLite normal en
`data/sanatorio.db`, así que vale cualquier cliente (el CLI `sqlite3` no viene
instalado de serie).

## 5. Scripts

Los atajos de `make` no sustituyen a los scripts de npm: cada objetivo del
`Makefile` llama a uno de estos.

| Script | Qué hace |
| ------ | -------- |
| `npm run dev` | Servidor con recarga en caliente (`tsx watch`). |
| `npm run build` | Compila a `dist/`. |
| `npm start` | Ejecuta lo compilado de `dist/`. |
| `npm run sync` | Sincroniza el catálogo global y sale. |
| `npm run sync -- <login>` | Sincroniza una persona y sus proyectos. |
| `npm run sync -- <login> --force` | Igual, pero ignorando los checkpoints. |
| `npm run db:migrate` | Aplica las migraciones pendientes. |
| `npm run cache:purge` | Borra solo lo caducado de la caché. |
| `npm run cache:flush` | Borra TODA la caché (el reset del solo-Madrid). |
| `npm run madrid:seed` | Baja y cachea el directorio del campus. |
| `npm test` | Suite completa. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run lint` | ESLint. |
| `npm run format` | Prettier. |

Y los objetivos del `Makefile`:

| Objetivo | Qué hace |
| -------- | -------- |
| `make up` | `install` + `env` + `migrate` + `dev`. |
| `make install` | `npm ci`, o nada si ya está al día. |
| `make env` | Copia `.env.example` a `.env` si no existe, y avisa de qué rellenar. |
| `make migrate` | `npm run db:migrate`. |
| `make purge-cache` | Borra solo lo caducado de la caché. |
| `make flush-cache` | Borra TODA la caché (reconstruir solo-Madrid). |
| `make madrid` | Siembra el directorio del campus (22 = Madrid). |
| `make dev` / `make start` | Servidor en modo desarrollo / compilado. |
| `make sync` | `npm run sync -- <login> --force`. |
| `make sync-fast` | Lo mismo respetando los checkpoints: no hace casi nada. |
| `make data` | Recuento de lo replicado, por tabla y por proyecto. |
| `make reset` | Borra la base de datos y la recrea vacía. |
| `make check` | `typecheck` + `lint` + `test` + `build`. |
| `make ping` | `GET /health`, para ver si el servidor responde. |
| `make session` | Crea una sesión falsa e imprime la cookie. |
| `make clean-sessions` | Borra las sesiones falsas. |
| `make clean` | Borra `dist/`, `data/` y `node_modules/`. |
| `make help` | La lista de arriba, sin tener que buscarla. |

`LOGIN` decide para quién sincroniza y de quién es la sesión falsa:

```bash
make sync LOGIN=otracuenta
make session LOGIN=otracuenta
```

Todos los scripts que usan el entorno pasan `--env-file=.env`, así que **no hay
que exportar nada a mano**. Si se llama al binario directamente (`npx tsx
src/server.ts`) entonces sí hay que pasarlo.

## 6. Antes de dar por buena una modificación

```bash
make check
```

Que es lo mismo que:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Los cuatro tienen que salir limpios. `npm test` tarda menos de un segundo: el
proveedor simulado de la API baja el delay entre llamadas a 1 ms.

## 7. La base de datos

El esquema son seis tablas y lo crea `npm run db:migrate`, que es idempotente
(las migraciones ya aplicadas no se repiten).

| Tabla | Qué guarda |
| ----- | ---------- |
| `users` | Persona: id numérico, nombre, avatar y puesto actual en el campus. |
| `projects` | Catálogo de proyectos: id, nombre y slug. |
| `user_projects` | Estado de cada persona en cada proyecto. La tabla que alimenta la lista de compañeros. |
| `availability` | Quién ha marcado estar disponible. Lo pone Sanatorio, no la API. |
| `sessions` | Sesiones opacas. El token de 42 no sale del servidor. |
| `sync_state` | Checkpoints: qué se sincronizó y cuándo. |

Para empezar de cero:

```bash
make reset
```

## 8. Problemas frecuentes

### El arranque falla con "no puede estar vacía" o "debe tener al menos 16 caracteres"

Falta una de las seis variables obligatorias. El mensaje de error nombra la
variable exacta, así que no hay que buscar a ciegas. Lo más común es
`SESSION_SECRET`, que en `.env.example` está vacío a propósito: hay que
generarlo.

### El arranque falla con `FRONTEND_ORIGINS no contiene ningún origen válido`

La variable se rellenó mal: vacía, o con un valor que no es una URL. Varios
orígenes se separan con comas o espacios.

### `/auth/me` devuelve 401 después de haber hecho login

Casi siempre es `FRONTEND_ORIGINS`: el navegador no está mandando la cookie de
sesión porque el origen no está en la lista. Comprueba que la URL del front
aparece tal cual, con `http://` y el puerto correcto.

### El login vuelve a 42 con `error=invalid_grant`

`FORTY_TWO_REDIRECT_URI` no coincide carácter a carácter con lo que hay
registrado en el panel de la app. Es la causa más frecuente de este error, y da
mucha guerra diagnosticarlo porque el mensaje de 42 no dice nada concreto.

### `403 Forbidden` con el cuerpo vacío al sincronizar

Falta el `User-Agent`. No es un problema de permisos: la API de 42 rechaza las
peticiones sin `User-Agent` con un `403` mudo.

### `429 Spam Rate Limit Exceeded`

Se ha pasado la cuota de 1 200 peticiones por hora. Bajar `SYNC_REQUESTS_PER_HOUR`
en el `.env` si la app comparte credenciales con alguien más. Importante: el
tope por minuto (`SYNC_REQUESTS_PER_MINUTE`, 100) **no** protege la cuota, porque
100 por minuto son 6 000 por hora.

### La primera carga de `/me/projects` tarda casi un minuto y pico

No es un cuelgue. Esa petición dispara el sincronizador antes de leer, y los
participantes de un proyecto grande son miles de entradas a 550 ms por petición.
Las siguientes llegan en menos de un segundo porque el checkpoint está fresco.

### Una petición se queda colgada y `curl` devuelve `HTTP 000`

Si la 42 está teniendo problemas (es lo que pasa con un `503` a
`/v2/projects_users`), el sincronizador reintenta con esperas y la petición de
lectura puede pasarse de cualquier timeout razonable aunque la réplica local
*tenga* los datos. Lo que se puede hacer mientras tanto:

```bash
make sync    # ver si la API responde ya, y reponer la réplica
make ping    # confirmar que el servidor está vivo
```

El backend debería servir la réplica local cuando la 42 falla, en vez de dejar la
petición colgada. Si te pasa esto a menudo, es un bug pendiente de arreglar, no
algo que estés haciendo mal.

### `better-sqlite3` falla al instalar

Falta un compilador de C. Ver la sección 1.

### El puerto 3000 está ocupado

```bash
PORT=3001 make dev
```

Pero entonces también hay que cambiar `FORTY_TWO_REDIRECT_URI` (el callback
lleva el puerto dentro) y el que use el front en `VITE_API_URL`.

## 9. Lo que no hace falta

Para desarrollo normal no hace falta nada de esto:

- **No hace falta un servidor de base de datos.** Es un fichero SQLite.
- **No hace falta Docker ni `docker-compose`.**
- **No hace falta desplegar nada** para probar. El despliegue está descrito en
  [`../docs/backend-requirements.md`](../docs/backend-requirements.md).
- **No hace falta pedir ningún scope nuevo.** La app pide `public profile`, que es
  lo único que habilita `/v2/me` y las lecturas que usa Sanatorio. Los scopes de
  escritura (`projects`, `elearning`, `tig`, `forum`) no se usan.