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

## Reglas duras
- No inventar features, endpoints o columnas que no estén en `001_init.sql`. Si falta algo, preguntar antes de improvisar.
- La lógica de reservas concurrentes y vencimiento de membresías pasa siempre por grill-me primero — la decisión de diseño la tomo yo, la implementación puede ser conjunta, pero necesito poder defenderla en entrevista.
- Ediciones quirúrgicas: no reescribir archivos completos si el cambio es puntual.
- Nunca commitear `.env` ni credenciales reales.