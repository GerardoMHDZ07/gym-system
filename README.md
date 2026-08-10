# Gym System

Sistema de gestión para gimnasio: membresías, check-in, pagos, reservas de clases,
rutinas de entrenamiento y seguimiento de progreso físico.

## Demo

🔗 **[gym-system-1-xoxy.onrender.com](https://gym-system-1-xoxy.onrender.com)**

Credenciales de prueba (todas usan el password `demo1234`):

| Rol | Email |
|---|---|
| Admin | `admin@gym.local` |
| Recepción | `recepcion@gym.local` |
| Entrenador | `carla@gym.local` |
| Miembro | `miguel@gym.local` |

> El backend corre en el tier gratuito de Render, que se duerme tras 15 min de inactividad. La primera carga después de un rato sin uso puede tardar 30-60 segundos — es la infraestructura gratuita, no un bug de la app.

## Stack

- **Backend**: Node.js + TypeScript + Express + PostgreSQL
- **Frontend**: React + TypeScript + Vite
- **Infra**: Docker Compose (db + backend)

## Estructura

```
gym-system/
├── backend/
│   ├── src/
│   │   ├── config/        # conexión a DB
│   │   ├── middleware/     # auth, error handling
│   │   ├── migrations/     # esquema SQL
│   │   └── modules/        # un módulo por dominio (routes + controller)
│   └── package.json
├── frontend/
│   └── src/
├── mcp-server/              # servidor MCP (stdio) para el backend
│   ├── src/                 # tools: health_check, login, whoami, logout, list_users
│   └── scripts/             # smoke test del flujo login/sesión
└── docker-compose.yml
```

## Setup

```bash
cp backend/.env.example backend/.env
docker compose up -d db          # levanta Postgres y corre 001_init.sql
cd backend && npm install && npm run dev
cd frontend && npm install && npm run dev
```

### Cuentas demo

El seed (`backend/src/migrations/002_seed.sql`) crea usuarios de prueba por rol,
con password `demo1234` para todos: `admin@gym.local`, `recepcion@gym.local`,
`carla@gym.local` / `jorge@gym.local` (entrenadores) y `miguel@gym.local` /
`sofia@gym.local` / `daniel@gym.local` (miembros). Solo existen en la base
sembrada por el seed; no se muestran en la pantalla de login del deploy.

### Tests del frontend

```bash
cd frontend && npm test          # suite unitaria (Vitest + Testing Library, jsdom)
cd frontend && npm run test:watch
```

## MCP server

El repo incluye un servidor [MCP](https://modelcontextprotocol.io) mínimo
(`mcp-server/`) que expone el backend a clientes MCP (asistentes/agentes), con
transporte **stdio** (HTTP/SSE remoto queda como trabajo futuro). Stack: Node +
TypeScript + `@modelcontextprotocol/sdk`.

### Tools

| Tool | Inputs | Descripción |
|---|---|---|
| `health_check` | — | GET `/health` del backend; devuelve status HTTP + body (tolera body no-JSON). |
| `login` | `email`, `password` | POST `/api/auth/login`; guarda la sesión (token + usuario) **en memoria del proceso**, nunca en disco. Devuelve nombre/email/rol, nunca el token. |
| `whoami` | — | Usuario logueado, o "no hay sesión activa, usa login primero". |
| `logout` | — | Borra la sesión en memoria. |
| `list_users` | — | GET `/api/users` con el token de la sesión. 401 → cierra la sesión; 403 → error sin tocarla. Requiere rol admin/recepción/entrenador. |

### Configuración

- `GYM_API_URL`: URL base del backend. Default: `https://gym-system-2sb4.onrender.com`
  (el backend real de producción). Para apuntar al backend local:
  `GYM_API_URL=http://127.0.0.1:4000`.

### Scripts

```bash
cd mcp-server
npm install
npm run dev          # dev con tsx
npm run build        # tsc -> dist/
npm start            # corre el build
npm run inspect      # abre MCP Inspector sobre el server
npm run smoke:login  # smoke test end-to-end del flujo login/sesión/list_users
npm run dev:http     # servidor HTTP (Streamable HTTP) en 127.0.0.1:4001
npm run start:http   # corre el build HTTP
npm run smoke:http   # smoke test end-to-end del transporte HTTP
```

Además del transporte **stdio**, el mismo server se sirve por **HTTP** (Streamable
HTTP, el estándar actual del spec) en `http://127.0.0.1:4001/mcp` — pensado para
clientes remotos. `MCP_PORT`/`MCP_HOST` para cambiar puerto/host (por defecto
solo localhost), y `MCP_CORS_ORIGINS` (coma-separado) para la allowlist de CORS,
con la misma convención que `CORS_ORIGINS` del backend. Cada sesión HTTP tiene
su propio estado de login en memoria. Por defecto solo escucha en `127.0.0.1`:
`MCP_HOST=0.0.0.0` lo expone a cualquier cliente (mismas credenciales demo, sin
rate limiting) — la allowlist de CORS solo protege browsers.

`smoke:login` habla JSON-RPC real por stdio contra el backend (por defecto el de
Render; con `GYM_API_URL=http://127.0.0.1:4000` contra el local) y valida las 14
respuestas del flujo `login → whoami → logout → whoami + list_users`, incluidos
los bordes (401 que no sobreescribe, 403 que no cierra la sesión).

> El backend de Render free se duerme tras 15 min de inactividad: si el smoke
test devuelve timeout, calentar el backend primero (un `curl` a `/health`).

## Deploy (Docker Compose)

```bash
docker compose up --build -d
```

- **Frontend**: http://localhost:8080 — nginx sirve el build de Vite y proxea
  `/api` al backend (`backend:4000` dentro de la red de compose).
- **Backend**: http://localhost:4000
- **Postgres**: publicado en `localhost:5433` (evita choque con un Postgres
  nativo en 5432); el backend usa `db:5432` en la red interna.
- En desarrollo local, en cambio, se usan `npm run dev` en cada carpeta: Vite
  proxea `/api` a `127.0.0.1:4000` (misma config que nginx en prod).

## CI (GitHub Actions)

El workflow `.github/workflows/ci.yml` corre en cada push/PR a `main`:

- **backend**: type-check + build.
- **contract-tests**: levanta Postgres con seed, arranca el backend contra él y
  corre la suite completa de tests de contrato (`npm test` — 149 tests).
- **frontend**: tests unitarios (Vitest + Testing Library) + type-check + build.

Además del deploy local con Docker Compose, la app corre en producción en
**Render** (frontend: `gym-system-1-xoxy.onrender.com`, backend:
`gym-system-2sb4.onrender.com`) con PostgreSQL en **Supabase**. En Render el
nginx del frontend proxea `/api` a la URL pública del backend (el tier free no
disponibiliza red privada entre servicios). El workflow
`.github/workflows/keep-alive.yml` corre cada 3 días y manda un `SELECT 1` a la
DB para que el tier gratuito de Supabase (que pausa proyectos tras 7 días sin
peticiones) no se duerma.

## Roadmap (portafolio)

- [x] **Fase 0** — Modelado de datos y arquitectura (este repo)
- [x] **Fase 1** — Backend base + auth por roles (admin, recepción, entrenador, miembro)
- [x] **Fase 2** — Check-in y control de acceso
- [x] **Fase 3** — Pagos y vencimientos de membresía
- [x] **Fase 4** — Reservas de clases (concurrencia, evitar overbooking)
- [x] **Fase 5** — Rutinas y catálogo de ejercicios
- [x] **Fase 6** — Progreso físico (métricas corporales)
- [x] **Fase 7** — Dashboard de reportes / analytics
- [x] **Fase 8** — Testing, pulido UI, deploy

## Decisiones de arquitectura

- Monolito modular (no microservicios) — más fácil de defender en entrevista para un
  proyecto individual y evita complejidad de infraestructura innecesaria.
- Un `users` con `role` en vez de tablas separadas por tipo de usuario — simplifica
  auth y las FKs de `trainer_id` / `assigned_to` en clases y rutinas.
- La lógica de negocio sensible (reservas concurrentes, cálculo de vencimientos)
  se escribe a mano, sin delegar a AI, para poder defenderla en entrevista técnica.

## Limitaciones conocidas y trabajo futuro

- **Anulación/rembolso de pagos (Fase 3):** los pagos son inmutables, como un
  ledger financiero — no se editan ni se borran una vez creados. No hay rembolso
  en esta fase. Revertir un pago implica decidir si se revierte el `end_date` de
  la membresía, si se corta el acceso de inmediato y si el rembolso es parcial:
  es una decisión  de negocio que merece su propio grill-me antes de implementarse.

- **Rutinas como agregado (Fase 5):** el `PUT /api/routines/:id` reemplaza el
  detalle completo (full replace en transacción), así que los ids de
  `routine_exercises` cambian en cada edición — la rutina conserva su `id`, los
  ejercicios no. El mismo ejercicio puede repetirse dentro de una rutina
  (supersets): no hay constraint `UNIQUE(routine_id, exercise_id)`.

- **Métricas corporales (Fase 6):** la fecha se fija al crear (el `PUT` solo
  corrige valores; para mover una medición de día hay que borrarla y recrearla).
  La regla "una por día" se aplica con check-then-insert dentro de la
  transacción (lock de la fila del user) porque la DB no tiene constraint
  `UNIQUE(user_id, date)` — endurecerlo es una decisión de esquema que merece
  su propio grill-me. Nota: `weight_kg`/`body_fat_pct` (NUMERIC) se devuelven
  como número en la API (cast `float8` en el SQL) porque `pg` serializa NUMERIC
  como string por defecto; el parser global no se toca para no cambiar el
  contrato de `payments.amount`.

- **Dashboard (Fase 7):** `GET /api/dashboard/summary` es un bundle de solo
  lectura con ventanas fijas (hoy, 7 y 30 días) — un rango custom `?from=&to=`
  queda como trabajo futuro si algún frontend lo necesita. El estado de
  membresía se calcula sobre la marcha con la misma regla que la materialización
  perezosa, pero sin escribir en la DB. La ocupación de clases se calcula con
  reservas `'reservada'`: el marcado de asistencia (`'asistio'`) sigue pendiente
  para medir ocupación real.
