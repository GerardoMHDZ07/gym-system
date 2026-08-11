# knowledge.md — gym-system

## Contexto del proyecto
Sistema de gestión de gimnasio (proyecto de portafolio). Monolito modular:
- Backend: Node.js + TypeScript + Express + PostgreSQL (pg, sin ORM)
- Frontend: React + TypeScript + Vite + Tailwind
- Infra: Docker Compose (Postgres + backend)

## Skills activas
- **Ponytail** por defecto en toda la sesión: antes de escribir código, evalúa si ya existe una solución más simple (nativa del lenguaje, del framework, o ya presente en el repo) antes de instalar una librería nueva o crear una abstracción. Prefiere la solución de menos líneas que cumpla el requisito.
- **grill-me**: invocar automáticamente antes de tocar cualquiera de estos puntos, sin esperar a que yo lo pida:
  - Reservas de clases (Fase 4) — control de concurrencia para evitar overbooking.
  - Cálculo de vencimiento y estados de membresía (Fase 3).
  - Cualquier decisión de esquema que no esté ya en `001_init.sql`.
  En esos casos, interroga una pregunta a la vez, con tu recomendación incluida, y explora el código antes de preguntar algo que ya se pueda inferir del repo. No implementes hasta que quede resuelto el árbol de decisiones.

## Convenciones
- Cada módulo vive en `backend/src/modules/<nombre>/` con `<nombre>.routes.ts` + `<nombre>.controller.ts`.
- Queries SQL directas con `pg` (sin ORM), siempre parametrizadas ($1, $2...), nunca concatenar strings.
- En `config/db.ts` hay `types.setTypeParser` para OID 1082 (`DATE` → texto `YYYY-MM-DD`) y 1114 (`TIMESTAMP` sin zona → texto `YYYY-MM-DD HH:MM:SS`): el default de pg las serializa con offset de zona horaria de la máquina (no determinista). Las columnas `TIMESTAMPTZ` (1184) sí son `Date`.
- Validar el body con `zod` antes de tocar la DB.
- Rutas protegidas con `requireAuth` / `requireRole` de `middleware/auth.ts`.
- Código en inglés; comentarios en español solo si aclaran lógica de negocio.

## Entorno
- Windows con PowerShell — los comandos sugeridos deben ser compatibles con PowerShell, no asumir bash.
- `docker compose up -d db` antes de correr el backend.
- El contenedor `db` mapea el puerto **5433** del host (no 5432): un Postgres nativo de Windows puede ocupar el 5432 y robarse las conexiones. `DATABASE_URL=postgres://gym:gym@localhost:5433/gym_db`.
- Esquema en `backend/src/migrations/001_init.sql` + seed demo en `002_seed.sql` (usuarios demo, password `demo1234`), se aplican automático en el primer `docker compose up`. Si cambia el esquema: `docker compose down -v` para reaplicar.
- El servicio `backend` de compose apunta a `db:5432` (red interna), no al puerto publicado del host.

## Tests (Fase 1 — auth + CRUD de usuarios)
- `cd backend && npm test` corre `node --test tests/auth.test.mjs`.
- Son tests de **contrato contra el servidor vivo** (sin mocks): validan el comportamiento de la API, no la implementación.
- Requisitos para que pasen:
  1. DB levantada con el seed aplicado: `docker compose up -d db` (si el volumen ya existía sin seed, `docker compose down -v` y volver a levantarla).
  2. Backend corriendo en `http://127.0.0.1:4000` (los tests usan `BASE_URL`, configurable por env).
- Usuarios del seed por rol (password `demo1234` para todos): `admin@gym.local`, `recepcion@gym.local`, `carla@gym.local` y `jorge@gym.local` (entrenador), `miguel@gym.local`, `sofia@gym.local` y `daniel@gym.local` (miembro).
- Convención del contrato: `POST /api/auth/login` devuelve `{ token, user }` sin `password_hash`; GET/POST/PUT/DELETE de `/api/users` solo con `Bearer` token y rol suficiente; mismo 401 para email inexistente o password incorrecto.

## Tests (Fase 2 — check-in y control de acceso)
- `cd backend && npm test` corre `node --test` (auto-descubre `tests/*.test.mjs`).
- Mismos requisitos que la Fase 1: DB con seed + backend vivo en `http://127.0.0.1:4000`.
- Convención del contrato:
  - `POST /api/checkins` solo `admin`/`recepcion`, con `user_id` en el body.
  - **Control de acceso**: 403 si el miembro no tiene membresía `status='activa'` Y `end_date >= CURRENT_DATE` (no valida el cálculo de vencimiento de la Fase 3: usa la membresía tal como está guardada).
  - **Máximo 2 check-ins por día calendario por miembro** (3º intento → 409). Limitación conocida: check-then-insert sin transacción; endurecible con `SELECT ... FOR UPDATE` / advisory lock.
  - Lectura (`GET /` y `GET /:id`) solo `admin`/`recepcion`; `GET /` acepta `?user_id=` opcional para filtrar por miembro.
  - **Sin `PUT`** (evento inmutable); `DELETE` solo `admin` (corregir errores de registro).
  - El server corre en UTC (contenedor oficial de Postgres): los tests comparan fechas UTC contra `CURRENT_DATE` del server.

## Tests (Fase 3 — pagos y vencimientos de membresía)
- `cd backend && npm test` corre `node --test` (auto-descubre `tests/*.test.mjs`); el archivo de la fase es `tests/memberships-payments.test.mjs`. Crea usuarios propios vía SQL y los borra en el `after`: no muta el seed ni interfiere con los otros archivos que corren en paralelo.
- Mismos requisitos que las fases anteriores: DB con seed + backend vivo en `http://127.0.0.1:4000`.
- Convención del contrato:
  - **Vencimiento**: materialización perezosa — al leer, cualquier membresía `status='activa'` con `end_date < CURRENT_DATE` pasa a `'vencida'` y el estado se persiste (lazy write-through). Sin jobs externos.
  - `POST /api/memberships` (admin/recepcion): crea desde hoy con `duration_days` del plan; 409 si el usuario ya tiene una `'activa'`; solo rol `'miembro'` (400 si no); 404 si user o plan no existen.
  - `PUT /api/memberships/:id` (solo admin) es exclusivamente **cancelación** (`{ status: 'cancelada' }`); 409 si no está `'activa'`. Las fechas nunca se editan a mano.
  - `POST /api/payments` (admin/recepcion): registra el pago Y renueva la membresía en la **misma transacción** con `SELECT ... FOR UPDATE` (dos pagos concurrentes no renuevan dos veces desde el mismo `end_date`):
    - `'activa'` → `end_date = end_date + duration_days` (se extiende, sin solaparse).
    - `'vencida'` → se reactiva desde hoy: `end_date = CURRENT_DATE + duration_days`.
    - `'cancelada'` → 409 (la baja es voluntaria y definitiva).
  - `method` ∈ `efectivo|tarjeta|transferencia`; `status` solo `'completado'` (el pago completado es lo que renueva). **Sin `PUT` ni `DELETE` en payments**: un pago es un evento financiero inmutable (ledger), no se edita ni se borra. El rembolso queda como trabajo futuro: revertir un pago implica decidir si se revierte el `end_date` de la membresía, si se corta el acceso de inmediato y si el rembolso es parcial — decisión de negocio que merece su propio grill-me.
  - Lectura (`GET` / `GET /:id`): admin/recepcion ven todo (con `?user_id=` opcional); el miembro solo sus propias membresías/pagos — 403 si intenta ver los de otro.

## Tests (Fase 4 — reservas de clases y CRUD de clases)
- `cd backend && npm test` corre `node --test`; el archivo de la fase es `tests/classes-bookings.test.mjs`. Crea usuarios/clases propios vía SQL/API y los borra en el `after`: no muta el seed.
- Decisiones cerradas en el grill-me de esta fase:
  - **CRUD de clases** (`/api/classes`): lectura para todo usuario autenticado; `POST`/`PUT` admin/recepcion (body con `name`, `trainer_id` que debe ser rol `entrenador`, `schedule_start`/`schedule_end` ISO 8601 con zona, `capacity` > 0; `schedule_end` debe ser posterior a `schedule_start`); `DELETE` solo admin. Los horarios se devuelven como texto UTC (`YYYY-MM-DD HH:MM:SS`).
  - **Reservas** (`/api/bookings`): `POST` con `{ class_id }` (miembro self-service, usa su token) o `{ class_id, user_id }` (admin/recepcion en nombre de un miembro; staff sin `user_id` → 400). Exige membresía activa (403 si no, igual que checkins). No se reservan clases ya comenzadas (409).
  - **Anti-overbooking**: transacción + `SELECT ... FOR UPDATE` sobre la fila de la clase (mismo patrón que `payments.create`): serializa las reservas concurrentes; si `count('reservada') >= capacity` → 409. Los tests lanzan 3 reservas simultáneas por el último cupo y exigen exactamente `1×201, 2×409`.
  - **Cancelación**: `PUT /api/bookings/:id` con `{ status: 'cancelada' }` (miembro dueño o staff; 403 si un miembro toca la de otro; 409 si ya estaba cancelada). La **re-reserva** se hace con `POST` de nuevo: revive la fila cancelada (UPDATE, no INSERT nuevo) revalidando cupo. `DELETE` solo admin (corregir errores de registro).
  - `'asistio'` queda sin usar: el marcado de asistencia es trabajo futuro (dashboard, Fase 8).
  - Limitación conocida: no hay check de solapamiento horario entre clases de un mismo miembro (YAGNI; se endurecería con un chequeo de rangos dentro de la transacción).

## Tests (Fase 5 — rutinas y catálogo de ejercicios)
- `cd backend && npm test` corre `node --test`; el archivo de la fase es `tests/routines-exercises.test.mjs`. Crea usuarios/ejercicios/rutinas propios vía SQL/API y los borra en el `after`: no muta el seed.
- Decisiones cerradas en el grill-me de esta fase:
  - **Catálogo de ejercicios** (`/api/exercises`): lectura para todo autenticado; `POST`/`PUT` solo `admin`/`recepcion`; `DELETE` solo `admin` (dato maestral, misma política que `classes`). Columnas: `name` (obligatorio), `muscle_group`, `description`, `video_url` (opcionales).
  - **Rutinas como agregado** (`/api/routines`): `POST`/`PUT` reciben los ejercicios **anidados** (`{ name, assigned_to, notes, exercises: [{ exercise_id, sets, reps, order_index?, rest_seconds? }] }`) y la transacción inserta o reemplaza todo atómicamente (el `PUT` es full replace: borra y reinserta `routine_exercises`). `created_by` sale **siempre del token**, nunca del body (no se puede falsificar).
  - **Quién escribe rutinas**: `entrenador` (solo las suyas — 403 si toca una ajena) y `admin`/`recepcion` (cualquiera). `DELETE` solo `admin`. El miembro no escribe.
  - **Visibilidad de lectura**: el miembro ve solo las rutinas con `assigned_to = él`; el entrenador solo las que creó (`created_by = él`); `admin`/`recepcion` ven todo con `?user_id=` opcional que filtra por `assigned_to`. El detalle (`GET /:id`, `POST`, `PUT`) embebe `exercises` con `exercise_name` (alias de JOIN); el listado no los incluye.
  - **Validaciones**: `assigned_to` debe existir y ser rol `'miembro'` (404 inexistente, 400 rol incorrecto — misma convención que `memberships.create`). **No exige membresía activa**: una rutina es un plan de entrenamiento, no un acceso (a diferencia de checkins/bookings). Los `exercise_id` del body deben existir (400). `order_index` opcional: si no llega, se usa la posición en el array del body.
  - Limitación conocida: el full replace regenera los ids de `routine_exercises` en cada `PUT` (la rutina conserva su `id`); no hay `UNIQUE(routine_id, exercise_id)` → el mismo ejercicio puede repetirse (supersets, a propósito).

## Tests (Fase 6 — métricas corporales)
- `cd backend && npm test` corre `node --test`; el archivo de la fase es `tests/metrics.test.mjs`. Crea usuarios/mediciones propios vía SQL/API y los borra en el `after`: no muta el seed.
- Decisiones cerradas en el grill-me de esta fase:
  - **Una medición por día calendario por miembro**: `POST /api/metrics` con una fecha que ya tiene medición → 409. La **fecha se fija al crear** (el `PUT` solo corrige valores: `weight_kg`, `body_fat_pct`, `notes`; los omitidos quedan iguales).
  - **Quién registra/edita**: el miembro **self-service** con su token (el `user_id` del body se ignora para miembros — no se puede falsificar); `admin`/`recepcion`/`entrenador` registran en nombre de un miembro (con `user_id`; sin él → 400). `DELETE` solo `admin`.
  - **Visibilidad**: el miembro solo ve SUS métricas (403 si ve la de otro); el staff ve todas con `?user_id=` opcional. Serie ascendente por `date`.
  - **Validación**: `date` opcional (por defecto hoy, `'YYYY-MM-DD'`, la columna es `DATE`); fecha futura → 400. `weight_kg`/`body_fat_pct` opcionales individualmente pero **al menos uno obligatorio**; rangos NUMERIC(5,2) → (0, 999.99] y NUMERIC(4,2) → [0, 99.99]. `notes` máx 2000.
  - **Concurrencia**: transacción + `SELECT ... FOR UPDATE` sobre la fila del user (mismo patrón que `bookings` con la fila de la clase): serializa los POST concurrentes del mismo miembro. Limitación conocida: sin `UNIQUE(user_id, date)` en la DB, el 409 es check-then-insert bajo el lock — endurecible a nivel esquema con grill-me.
  - **Serialización NUMERIC**: `pg` devuelve NUMERIC como string por defecto (p. ej. `payments.amount`). En metrics se castea `weight_kg::float8`/`body_fat_pct::float8` en el SQL para que el JSON lleve números (gráfico de progreso). **No** tocar el parser global de OID 1700: cambiaría el contrato de `payments.amount`.
  - Fecha del seed relativa: `002_seed.sql` siembra la medición "de hoy" de miguel con la fecha de cuando se aplicó el seed; si el seed se aplicó ayer, esa entrada es `CURRENT_DATE - 1`. Los tests usan fechas pasadas fijas (nunca `-1` ni `-30/-31` para no colisionar con el seed) o a sofia (que el seed no toca).

## Tests (Fase 7 — dashboard de reportes / analytics)
- `cd backend && npm test` corre `node --test`; el archivo de la fase es `tests/dashboard.test.mjs`. Crea un miembro + membresía activa + pago + check-in en el `before` y los borra en el `after` (CASCADE): no muta el seed.
- Decisiones cerradas en el grill-me de esta fase:
  - **Bundle único**: `GET /api/dashboard/summary` (montado en `/api/dashboard`). **Solo `admin`/`recepcion`** (incluye ingresos; el entrenador no ve datos financieros).
  - **Ventanas fijas**: hoy, últimos 7 y 30 días, sin params. Rango custom `?from=&to=` = trabajo futuro (YAGNI).
  - **Solo lectura**: el estado de membresía se calcula sobre la marcha con la MISMA regla que la materialización perezosa (`'activa'` solo si `end_date >= CURRENT_DATE`; una `'activa'` vencida cuenta como vencida) pero **sin escribir** en la DB — el dashboard es un agregado de lectura, no muta nada.
  - **KPIs**: `members` (total, `new_last_30d`); `memberships` (`active` + `breakdown` por status); `checkins` (`today`, `last_7d_total`, `by_day_last_7d` — serie de 7 días con `generate_series` llenando ceros); `revenue` (`today`, `last_30d`, `by_method_last_30d`); `classes` (`upcoming_7d`, `active_bookings`, `avg_occupancy_7d` — reservas `'reservada'`/capacidad, 0..1).
  - **Serialización**: `count(*)::int` y `SUM`/`AVG` de NUMERIC a `::float8` para que el JSON lleve números (pg devuelve int8/numeric como string por defecto). Son 9 queries independientes en `Promise.all`.
  - **Tests con cotas inferiores e invariantes**: los archivos de test corren en paralelo y este bundle es global, así que no se aseveran valores exactos — se verifican sumas consistentes (serie diaria = total 7d, por método ≈ total 30d), tipos numéricos, y cotas derivadas del seed + datos propios.
  - Trabajo futuro relacionado: marcado de asistencia (`'asistio'`) para medir ocupación real de clases (hoy se usa reserva vigente).

## Fase 8 — frontend completo, CI y deploy
- **Frontend** (`frontend/`): app completa por rol en Vite + React + Tailwind (decisión del grill-me). Auth con JWT en `localStorage` (`src/auth/AuthContext.tsx`), client HTTP tipado con proxy de `/api` (`src/api/client.ts`), sidebar de navegación filtrada por rol (`src/components/Layout.tsx`), páginas por módulo. En dev, Vite proxea `/api` → `127.0.0.1:4000`; en prod lo hace nginx.
- **Decisiones de contrato de esta fase** (grilleadas antes de tocar el backend):
  - `GET /api/plans` (nuevo, solo lectura, autenticado): catálogo de `membership_plans` con `price` casteado a float8. Lo necesita la UI del alta de membresías (no existía forma de listar planes).
  - `GET /api/users` (y `/:id`): ahora también para `entrenador` (solo lectura, columnas públicas). Lo necesita para asignar rutinas y registrar métricas; la escritura sigue siendo `admin`/`recepcion` y el DELETE solo `admin`.
- **Deploy**: `frontend/Dockerfile` multi-stage (node build → nginx) + `frontend/nginx.conf` (SPA fallback + proxy `/api` → `backend:4000`). Servicio `frontend` en `docker-compose.yml` (`8080:80`). Docs en README.
- **Deploy real (Render + Supabase)**: el backend vive en `gym-system-2sb4.onrender.com` y el frontend en `gym-system-1-xoxy.onrender.com` (nginx proxea `/api` a la URL pública del backend porque Render free no da red privada). La DB es Supabase, pingueada por el workflow `keep-alive.yml` (secrets de GitHub) para que no se pause.
- **CORS restringido por allowlist**: el frontend llama siempre a `/api` relativo (proxied por Vite/nginx), así que el Origin que recibe el backend es el del dominio del frontend. `backend/src/index.ts` permite solo los orígenes de `CORS_ORIGINS` (env, coma-separado; defaults: `localhost:5173`, `127.0.0.1:5173`, `localhost:8080` y el frontend de Render). Peticiones sin header Origin (curl, health checks, server-to-server) se permiten siempre. Si el CORS bloquea algo raro en dev, revisar que el Origin esté en la lista.
- **`backend/.dockerignore` es obligatorio** (excluye `node_modules`, `dist`, `.env`, `*.log`): sin él, `COPY . .` mete el `node_modules` local de **Windows** al contenedor Linux y el build rompe con `node.exe: not found` (el shim `.bin/tsc` de npm en Windows referencia `PROG_EXE=node.exe`). El frontend ya lo tenía; el del backend se agregó cuando el build de compose falló por esto.
- **CI**: `.github/workflows/ci.yml` agrega el job `contract-tests`: Postgres como servicio + seed + backend en background (`npx tsx src/index.ts &` con health check) + `npm test`. Env del job: `DATABASE_URL`, `JWT_SECRET`, `PORT` (no hay `.env` en CI).
- **Testing del frontend**: suite unitaria con Vitest + Testing Library (`cd frontend && npm test`, jsdom sin browser). Cubre el cliente HTTP (`src/api/client.ts`), auth/guard de rutas, Layout, Login, helpers de UI y una página de ejemplo (`Members`) con el patrón de mock de `api`. Los tests de página corren contra la API mockeada; la cobertura real de los endpoints vive en los tests de contrato del backend.
- Trabajo futuro: marcado de asistencia (`'asistio'`), rango custom en el dashboard.

## Tests (Frontend — Vitest + Testing Library)
- `cd frontend && npm test` corre `vitest run` (jsdom, sin browser); `npm run test:watch` para watch. Setup común en `frontend/src/test/setup.ts` (matchers de jest-dom + `cleanup()` explícito porque no se usan globals de Vitest).
- **No** se fija `TZ=UTC` en el entorno: en Windows, cambiar `process.env.TZ` en runtime no afecta a `Date` (lo ignora). Los tests de formato (`fmtDateTime`) comparan contra el mismo formateo local del runner para ser deterministas en cualquier máquina/CI.
- Cobertura actual (8 archivos, co-located en `src/`):
  - `src/api/client.test.ts` — headers de auth, serialización del body, `ApiError` (status + mensaje del server), 401 → limpia sesión + dispara `gym:unauthorized`, 204 → `undefined`.
  - `src/auth/AuthContext.test.tsx` — sesión inicial desde localStorage, login (guarda token + user), error propagado, evento `gym:unauthorized` cierra sesión en vivo, logout limpia todo.
  - `src/auth/ProtectedRoute.test.tsx` — sin sesión → `/login`; rol no permitido → `/`; rol permitido → contenido.
  - `src/components/Layout.test.tsx` — nav filtrada por rol, nombre/rol del usuario, logout navega a `/login`.
  - `src/pages/Login.test.tsx` — login OK navega, error del server se muestra, con sesión redirige. (Los labels no tienen `htmlFor`: se buscan por placeholder. Desde que el sitio está desplegado, la página ya no muestra las cuentas demo: se quitaron los botones y los placeholders con credenciales (`admin@gym.local`/`demo1234`); las credenciales viven solo en el README/seed para no regalar el acceso admin en la UI.)
  - `src/components/ui.test.tsx` — `roleLabel`, `fmtDateTime`/`fmtDate`, `Badge`.
  - `src/pages/Members.test.tsx` — patrón de referencia para páginas: `vi.mock("../api/client", async (importOriginal) => ({ ...actual, api: apiMock }))` mockea solo `api()` y conserva `ApiError`/`ROLES`/`roleLabel` reales. Listado, búsqueda, `Eliminar` solo para admin, DELETE con `confirm` + recarga.
  - `src/App.test.tsx` — **integración**: App + AuthProvider + rutas reales con `api()` mockeada por endpoint (un mini-backend en el test). Login real → dashboard de staff (KPIs), navegación por sidebar, redirects del guard por rol, logout, ruta inexistente → login.
- `npm run build` incluye `tsc --noEmit`, que type-checkea también los tests (viven dentro de `src/`): la suite queda cubierta por el type-check del CI.
- **Bugs que el test de integración destapó y se corrigieron** (no reproducibles con tests unitarios mockeando `useAuth`):
  - `Login.tsx` tenía un early return (`if (user) return <Navigate .../>`) **antes** de los `useState`: al hacer login en vivo el conteo de hooks cambiaba entre renders → "Rendered fewer hooks than expected" y React desmontaba el árbol. El return se movió después de los hooks (siempre se ejecutan incondicionalmente).
  - `Layout.tsx` hacía `if (!user) return null` antes de pintar el `<Outlet>`: el `ProtectedRoute` (que redirige a `/login`) nunca llegaba a montarse y un visitante sin sesión en `/miembros` veía **pantalla en blanco**. Ahora `Layout` redirige a `/login` con `state={{ from: location }}` (mismo patrón que `ProtectedRoute`).
- El CI (`.github/workflows/ci.yml`, job `frontend`) corre `npm test` antes del build.

## MCP server (Fases 1-2) — `mcp-server/`
- Servidor MCP mínimo (Node + TypeScript + `@modelcontextprotocol/sdk`, transporte **stdio**; HTTP/SSE remoto = fase futura). ESM (`"type": "module"`), TS strict/NodeNext. Scripts: `npm run dev` (tsx), `npm run build` (tsc), `npm start` (dist), `npm run inspect` (MCP Inspector). El `allowScripts` para `esbuild@0.28.2` es obligatorio en Windows (misma convención que el backend); si un futuro install resuelve otro patch de esbuild hay que agregarlo a mano.
- **`GYM_API_URL`** (env): URL base del backend; default `https://gym-system-2sb4.onrender.com`. Vacía o sin setear → default (misma convención que `CORS_ORIGINS` en el backend); se quitan barras finales. Para apuntar al backend local en dev: `GYM_API_URL=http://127.0.0.1:4000`.
- Todos los fetches usan `AbortSignal.timeout(10_000)`. Render free se duerme tras inactividad y el wake-up puede superar los 10s: en ese caso el tool devuelve `error: The operation was aborted due to timeout` hasta que el backend se calienta (no es un bug; es el timeout funcionando).
- **Fase 1 — `health_check`** (sin inputs): GET `{apiUrl}/health`, devuelve `status` + body pretty-printed; si el body no es JSON válido se devuelve el texto crudo (p. ej. el HTML del SPA fallback de nginx) sin tronar.
- **Fase 2 — sesión y auth**: sesión en memoria del proceso (`let session: Session | null`, un solo slot) con `token` + `user {id, name, email, role}` — **nunca en disco, nunca hardcodeada**.
  - `login({ email, password })`: POST `{apiUrl}/api/auth/login` con el mismo schema zod que el backend (`z.string().email()` / `z.string().min(1)`). Guarda la sesión **solo sobre éxito**; 401 → `error: credenciales inválidas (401)` sin tronar; el token **nunca** aparece en la respuesta del tool (solo nombre/email/rol).
  - `whoami()`: **local puro** (no toca el backend) — nombre/email/rol si hay sesión, o `No hay sesión activa, usa login primero`.
  - `logout()`: borra la sesión (`Sesión cerrada` / `No había sesión activa`).
- **Decisiones cerradas en el grill-me de la Fase 2** (preguntadas antes de implementar):
  - **Login estando logueado**: sobreescritura silenciosa, pero solo si las credenciales son válidas; un login fallido deja la sesión anterior intacta.
  - **Revalidación del token**: delegada por completo al backend — el JWT es stateless (8h, validado en cada request por `requireAuth`) y no hay endpoint de refresh ni `/auth/me`. `whoami` es local por diseño. Si algún día se quisiera revalidar proactivamente, merece grill-me (hoy implicaría inventar un endpoint nuevo).
- **Fase 3 — tools autenticados**: `list_users` (sin inputs) hace GET `{apiUrl}/api/users` con `Authorization: Bearer <token>` y devuelve el **JSON pretty-printed** tal cual del backend (columnas públicas: `id, name, email, role, created_at`; nunca `password_hash`).
  - **Contrato del 401/403 (grill-me de la Fase 3)**: sin sesión → mismo mensaje que `whoami`; **401 → se limpia la sesión** (`Sesión vencida o inválida (401): se cerró la sesión, usa login primero`) porque el token guardado ya es basura y `whoami` no debe mentir; **403 → error `sin permisos` SIN tocar la sesión** (el token es válido, solo falta rol).
  - **Un solo tool a propósito (decisión de alcance del grill-me)**: lo que se establece es el patrón (usar token, manejar 401/403); el resto de endpoints de lectura (plans, classes, memberships...) serían copy-paste del mismo patrón en fases futuras. Sin filtros ni inputs (YAGNI): cada fila trae el `role` y el LLM filtra solo.
  - El branch del 401 se valida por revisión de código, no e2e: un login real siempre produce un token válido y no hay forma de forzar un 401 contra el backend real (no hay endpoint de revocación). El smoke test cubre los branches alcanzables: admin → JSON con usuarios, miembro → 403 y sesión intacta, sin sesión → pedir login.
- **Fase 4 — transporte HTTP remoto** (`src/http.ts`): Streamable HTTP en `/mcp` (GET para el stream SSE, POST para JSON-RPC, DELETE para teardown) + `/health`. Es el estándar actual del spec — el SSE legacy de dos endpoints está deprecado. `npm run dev:http` / `npm run start:http`; por defecto `127.0.0.1:4001` (`MCP_HOST`/`MCP_PORT` para exponerlo; el helper `createMcpExpressApp` del SDK activa protección DNS rebinding en localhost).
  - **`enableJsonResponse: true`**: todos los tools son request/response (sin notificaciones server→client), así que los POST responden JSON directo. El GET igual abre el stream SSE (el spec lo exige), pero en modo JSON-response no emite eventos hasta que haya algo que notificar: no hay priming event que esperar.
  - **Un `McpServer` por sesión HTTP**: el `Server` del SDK v1.30 solo admite UNA conexión a la vez (error "Already connected to a transport. Use a separate Protocol instance per connection"). Cada `Mcp-Session-Id` crea su propio server vía la factory `createMcpServer()` de `src/mcp.ts` (compartida con `src/index.ts`): multi-cliente OK y cada cliente HTTP tiene su propio estado de login. El stdio quedó intacto (mismo comportamiento, 14/14 en el smoke).
  - **Quirk del SDK**: el `sessionId` se genera DURANTE el `initialize`, no en el constructor del transporte — el Map de sesiones se llena desde el hook `onsessioninitialized`, nunca antes (un `Map.set` temprano lo guardaba bajo `undefined` y la segunda request creaba otro transporte).
  - **CORS allowlist**: `MCP_CORS_ORIGINS` (env, coma-separado; defaults de dev) — misma convención que `CORS_ORIGINS` del backend; sin header Origin (curl, server-to-server) se permite siempre.
  - **Sesiones huérfanas**: un cliente que muere sin DELETE (crash, pierde el `Mcp-Session-Id`) deja su sesión colgada. El `onclose` del transporte la limpia si el cierre es limpio; para los huérfanos hay un sweep periódico (60s) que cierra sesiones inactivas > 30 min (`lastUsed` se toca en cada request). El timeout es generoso porque la sesión MCP sostiene el login en memoria.
  - **Exposición**: por defecto solo `127.0.0.1`. `MCP_HOST=0.0.0.0` lo deja abierto a CUALQUIER cliente con las credenciales demo y sin rate limiting — la allowlist de CORS solo protege browsers (server-to-server se permite por diseño). Mismo modelo de confianza que el backend, pero el backend en prod va detrás de nginx.
  - **Smoke test**: `npm run smoke:http` — 18 aserciones: handshake (protocolVersion + Mcp-Session-Id), 202 de notificaciones, **multi-cliente** (2 sesiones conviviendo con su propio server/login), flujo login completo sobre HTTP, GET SSE (200 + `text/event-stream`), DELETE (teardown → GET posterior 400) y CORS (origen permitido vs denegado). Nota: el cliente debe mandar `Accept: application/json, text/event-stream` en los POST (requisito del spec; si no → 406 "Not Acceptable").
  - **Validado end-to-end con clientes reales**: (1) el cliente oficial del SDK (`Client` + `StreamableHTTPClientTransport`) corrió el flujo login → whoami → list_users → logout completo contra `http://127.0.0.1:4001/mcp`; (2) el MCP Inspector CLI (`npx @modelcontextprotocol/inspector --cli --server-url .../mcp --method tools/list|tools/call`) listó los 5 tools y llamó `health_check` OK. Dato: el cliente del SDK exige `arguments: {}` explícito en `callTool` para tools sin inputs (valida client-side); el server acepta también calls sin `arguments` (lo probó el Inspector).
- **Smoke test del flujo login → whoami → logout → whoami + list_users** (contra el backend real, sin mocks): `npm run smoke:login` (hace build y corre `node scripts/smoke-login.mjs`). El driver es un cliente JSON-RPC **secuencial**: envía un mensaje, espera su respuesta, y recién entonces el siguiente. Asertea las 14 respuestas del flujo con credenciales del seed (`admin@gym.local` / `miguel@gym.local`, password `demo1234`), incluidos los bordes: whoami sin sesión, 401 que NO sobreescribe, sobreescritura silenciosa, `list_users` como admin (JSON con usuarios del seed), `list_users` como miembro (403 y sesión intacta), `list_users` sin sesión, logout y whoami final.
  - **Por qué no pipear todo el input de golpe**: el SDK procesa requests concurrentemente, así que al mandar todos los mensajes juntos por stdin un `whoami` puede ejecutarse mientras el `login` anterior sigue en vuelo y responder "no hay sesión" (falso negativo; pasó en la fase con ids desordenados). El driver espera cada respuesta para evitar eso.

## MCP server (Fase 5-6) — seguridad del transporte HTTP y empaquetado
- **Dockerfile** (`mcp-server/Dockerfile`, patrón del backend): `node:20-alpine`, `WORKDIR /app`, `COPY package*.json` + `npm install` (respeta el `allowScripts` de esbuild), `COPY . .` + `npm run build`, `EXPOSE 4001` (solo documentación) y `CMD ["npm", "run", "start:http"]` → arranca `dist/http.js` (el transporte HTTP), **NUNCA** `dist/index.js` (entrypoint stdio, solo para Claude Desktop local). El `mcp-server/.dockerignore` es obligatorio (misma razón que el del backend: sin él, `COPY . .` mete el `node_modules` local de Windows al contenedor Linux y rompe el build). Validado e2e: `docker build` + `docker run` con `MCP_HOST=0.0.0.0` → `curl /health` devuelve `{"ok":true}`.
- **API key compartida (Capa 1)** en `src/http.ts`: middleware `requireApiKey` montado con `app.use("/mcp", ...)` — corre ANTES de toda la lógica de sesión/transporte MCP y sobre las tres rutas `/mcp` (POST/GET/DELETE). Exige el header `X-MCP-API-Key` == env `MCP_API_KEY`: falta o no coincide → **401** JSON; `MCP_API_KEY` sin configurar → **503** en todo `/mcp` (**fail-closed**: olvidarse de setearla en el deploy nunca deja el endpoint abierto) + `console.warn` al arrancar. `/health` queda **sin proteger** (check de disponibilidad, no expone datos). El preflight OPTIONS lo corta el middleware de `cors` sin llegar a la key. **No aplica a `src/index.ts`** (stdio, uso local con Claude Desktop).
- **Rate limit (Capa 2)** con `express-rate-limit@^8.6.2` (v8, compatible con Express 5): solo sobre `POST /mcp` (los POST son los intentos de login/tool calls), **30 requests/min por IP** (ventana 1 min). Los 401 de la API key corren antes y NO consumen cuota (un atacante sin key está ya bloqueado). El 429 responde JSON sin tocar el transporte. **`app.set("trust proxy", 1)`** (una esperanza): sin eso, detrás del proxy de Render `req.ip` sería la IP del LB y todos los clientes compartirían un solo bucket. Tradeoff conocido: si el contenedor se expone SIN proxy adelante, un cliente puede rotar `X-Forwarded-For` para resetear su bucket (el rate limit se vuelve por-header en vez de por-IP) — aceptable porque la API key es la barrera primaria.
  - Edge conocido: `express.json()` (montado por `createMcpExpressApp`) corre ANTES de `requireApiKey`, así que un request con JSON malformado y sin key responde `400 JSON inválido` en vez de 401. No filtra nada ni toca la lógica de transporte; se acepta tal cual.
- **Env del deploy**: `MCP_API_KEY` es **requerida** para el modo HTTP (se inyecta en el deploy, no en la imagen; el Dockerfile la documenta). Opcionales: `MCP_HOST`/`MCP_PORT` (default seguro `127.0.0.1:4001`), `MCP_CORS_ORIGINS`, `GYM_API_URL`.
- **Smoke test actualizado**: `smoke-http.mjs` ahora arranca el server con `MCP_API_KEY` de prueba y manda `X-MCP-API-Key` en todos los requests a `/mcp`. Aserciones nuevas: POST sin key → 401, key incorrecta → 401, `/health` sin key → 200, y ráfaga de 35 POSTs → al menos un 429 (el flujo consume 9 de la cuota de 30).
- No inventar features, endpoints o columnas que no estén en `001_init.sql`. Si falta algo, preguntar antes de improvisar.
- La lógica de reservas concurrentes y vencimiento de membresías pasa siempre por grill-me primero — la decisión de diseño la tomo yo, la implementación puede ser conjunta, pero necesito poder defenderla en entrevista.
- Ediciones quirúrgicas: no reescribir archivos completos si el cambio es puntual.
- Nunca commitear `.env` ni credenciales reales.