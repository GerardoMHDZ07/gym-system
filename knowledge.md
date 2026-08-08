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

## Reglas duras
- No inventar features, endpoints o columnas que no estén en `001_init.sql`. Si falta algo, preguntar antes de improvisar.
- La lógica de reservas concurrentes y vencimiento de membresías pasa siempre por grill-me primero — la decisión de diseño la tomo yo, la implementación puede ser conjunta, pero necesito poder defenderla en entrevista.
- Ediciones quirúrgicas: no reescribir archivos completos si el cambio es puntual.
- Nunca commitear `.env` ni credenciales reales.