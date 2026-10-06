# Sanatorio 42 🩺

> ¿Te has atascado? Pasa a consulta: aquí siempre hay alguien de guardia.

Proyecto para la Hackathon de la Semana del Emprendimiento de 42 Madrid (octubre de 2026).
🌐 **Web:** https://sanatorio-42.vercel.app

## Equipo

| Login | Responsabilidades |
|---|---|
| albrodri | Backend |
| legomez | Frontend: UI responsive, botones y topbar daptable |
| plopez-l | Frontend: estructura del repositorio, diseño e interfaz |

## El dolor

En 42 aprendemos peer to peer, pero cuando te atascas en un proyecto no es fácil saber quién lo está haciendo ahora mismo, quién está en el campus y quién tiene tiempo para echarte una mano. Acabas preguntando en Slack o dando vueltas por los clusters.

## La solución

Sanatorio 42 es una web en la que, con tu cuenta de 42:

- Eliges el proyecto que se te resiste ("¿Qué te duele hoy?").
- Ves qué compañeros lo están haciendo, en qué puesto del cluster están y si están "de guardia", es decir, disponibles para ayudar.
- Te puedes poner de guardia tú para ayudar a otros.

Los datos de proyectos y ubicaciones se obtienen de la API de 42.

## Metodología de ideación y prototipado

La idea nace de nuestro interés por ayudar a los estudiantes a quienes les cuesta pedir ayuda, ya sea por timidez, por poca relación con ciertos grupos o por haberse quedado rezagados. Sanatorio 42 les permite encontrar a otros estudiantes en su misma situación, o a alumnos que ya han cursado y aprobado el proyecto en el que están.

La idea inicial era algo más cercana a un botón dentro de la intra, o una mejora de los mecanismos para encontrar peers. Optamos por una plataforma más amigable y con un enfoque clínico, de ahí el nombre 'Sanatorio 42', que además da a la propuesta una identidad propia.

Para el prototipado, el front se construyó primero con datos de prueba (mock) siguiendo el contrato de `docs/api.md`, de modo que front y back pudieran avanzar en paralelo. Después se conectó con el back real. La interfaz se probó en móvil y escritorio y se fue ajustando a partir de lo que resultaba confuso (por ejemplo, el botón de volver y la cabecera en pantallas pequeñas).

## Gestión del proyecto

- Repositorio en GitHub con una rama por área (`front`, `back`) y `main` como versión estable.
- Los cambios llegan a `main` mediante pull requests.
- El contrato entre front y back está en `docs/api.md`, para que ambas partes trabajen en paralelo. Mientras el back no está listo, el front usa datos de prueba (mock) con el mismo formato.

## Arquitectura

- `front/`: React + Vite.
- `back/`: Node + Fastify + SQLite, organizado por capas (`api/` cliente de 42, `auth/` OAuth y sesiones, `db/`, `services/`, `sync/`, `http/`). Gestiona el login con la API de 42 (OAuth), de modo que el client secret nunca llega al navegador.
- `docs/api.md`: contrato de endpoints entre front y back.
- Tests unitarios y de integración del back (`npm test`) contra un proveedor simulado de la API de 42, con SQLite en memoria para que no dependan del orden de ejecución.

## Cómo levantar el proyecto

### Backend

```bash
cd back
npm install
cp .env.example .env     # rellenar FORTY_TWO_UID, FORTY_TWO_SECRET y SESSION_SECRET
npm run db:migrate
npm run dev              # http://localhost:3000
```

Variables principales: `FORTY_TWO_UID`, `FORTY_TWO_SECRET`, `FORTY_TWO_REDIRECT_URI` (debe coincidir exactamente con la registrada en el panel de 42), `SESSION_SECRET` (mínimo 16 caracteres), `FRONTEND_ORIGINS` y `DATABASE_PATH`. Todas están comentadas en `back/.env.example`. Más detalle en `back/README.md`.

### Frontend

```bash
cd front
cp .env.example .env
npm install
npm run dev
```

Variables de `front/.env`:

- `VITE_USE_MOCK`: con `true` usa datos de prueba; con `false`, el back real.
- `VITE_MOCK_LOGGED_IN`: en modo mock, con `true` entra directamente sin pasar por el login.
- `VITE_API_URL`: URL del back.

## Herramientas

- opencode, asistente de programación con IA, para generar y modificar el frontend.
- GitHub Codespaces como entorno de desarrollo en la nube.

## Seguridad

No hay claves ni secretos en el repositorio: los archivos `.env` están en el `.gitignore`, y las variables necesarias se documentan en los `.env.example`.

## Uso de la API de 42

- **Login:** Authorization Code con PKCE. El token de 42 nunca sale del servidor; al navegador solo llega una cookie de sesión firmada. Scopes pedidos: `public profile`.
- **Proyectos y estado del usuario:** distinguen a los especialistas (proyecto aprobado) de los pacientes (cursándolo), y alimentan los filtros del front.
- **Ubicación:** el campo `location` de `/v2/users/:login` decide quién está "de guardia" (disponible y en un puesto del campus) y dónde quedar.
- **Solo Madrid:** la lista de compañeros se filtra contra el directorio del campus 22.
- **Caché:** las peticiones del front se responden desde SQLite y un sincronizador mantiene la copia al día, respetando el límite de la API (2 req/s y 1200 req/h). Si 42 falla, se sirven los últimos datos guardados.

## Registro de problemas técnicos

| Problema | Solución |
|---|---|
| Node.js y opencode no arrancaban en un Mac con macOS 10.15, porque sus versiones actuales necesitan macOS 13 o posterior. | Desarrollo en GitHub Codespaces, un entorno en la nube con un sistema actualizado. |
| La web de Node.js redirigía la descarga del instalador a su blog. | Descarga directa del instalador con `curl` desde la terminal. |
| La traducción automática del navegador traducía los nombres de los archivos en el editor (`back` aparecía como "De vuelta"). | Desactivar la traducción en el dominio del Codespace. |
| El navegador bloqueaba pegar texto en la terminal del Codespace. | Escribir las instrucciones largas en un archivo dentro del editor y pedir al asistente que lo lea. |
| La carpeta `dist/`, generada al compilar, aparecía como pendiente de subir. | Añadirla al `.gitignore`. |
| Al añadir el nombre del producto, la cabecera no cabía en una sola fila. | `flex-wrap: nowrap`, textos más cortos y elementos decorativos ocultos en el móvil. |
| El Codespace tardaba varios minutos en arrancar. | Hacer los cambios pequeños desde la web de GitHub, y hacer `git pull` antes de volver a trabajar en el Codespace. |
| En móviles se colapsaban varias herramientas de la interfaz. | Se ha implementado `topbar-brand` y `topbar-user` junto a `user-login` para controlar que todo sea visible en dos filas. |
| `GET /v2/campus/:id/locations` devuelve el histórico completo (más de 750 000 registros en Madrid), no las ubicaciones actuales; sincronizarlo llevaría más de 6 h por la cuota. | Usar el campo `location` de `/v2/users/:login`, que trae el puesto actual o `null`. |
| Fastify reemplazaba el `Set-Cookie` anterior en vez de añadirlo y el navegador se quedaba sin sesión. | Enviar las dos cookies del callback juntas en un array. |
| Confundir `undefined` y `null` vaciaba todas las ubicaciones en cada sincronización. | `null` borra la ubicación y la clave ausente no la toca, con tests que lo fijan. |
| El tope por minuto no protegía la cuota horaria de la API (100/min son 6000/h). | Limitador con ventanas deslizantes de minuto y de hora. |
| La API respondía `403` sin cuerpo a peticiones sin `User-Agent`. | Variable `FORTY_TWO_USER_AGENT`. |
| El botón para volver a la ventana principal no es intuitivo. | Se ha implementado la clase `back-btn`, así como su `:hover` y `:focus-visible` para controlar su visibilidad. |
| El título se sentía muy simple. | Se ha implementado el login del usuario en el título cuando inicia sesión. |

## Memoria de trabajo

| Fecha | Login | Horas | Trabajo realizado |
|---|---|---|---|
| 03/10 | plopez-l | 3,5 h | Creación del repositorio y su estructura, contrato de API, entorno en Codespaces, frontend completo con datos de prueba, diseño de Sanatorio 42 y PR #1. |
| 03/10 | plopez-l | 2 h | README, requisitos del backend, publicación en Vercel, especialistas, filtros por tipo, terapia de grupo y regla de guardia en el campus. |
| 04/10 | plopez-l | 1 h | AGENTS, Relevo front. |
| 05/10 | plopez-l | 3 h | Conexión del front con el back en producción, configuración de Vercel, Turso y la app de la intra, arreglo de las migraciones para Turso. |
| 04/10 | legomez | 3 h | Configuración de interfaz y ajustes en el css para hacerla responsiva para móviles o pantallas pequeñas. |
| 05/10 | legomez | 1 h | Configuración del botón de "Volver a la sala de espera" para hacerlo más visible |
| 06/10 | legomez | 1 h | Añadido el login del usuario en el título |
| 03/10 | albrodri | 5 h | Configuración del backend|
| 05/10 | albrodri | 1 h | Analisis de la api e integración en el back|
| 06/10 | albrodri | 2 h | Añadida la validación de usuarios con su cuenta de 42 |

