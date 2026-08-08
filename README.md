# Gym System

Sistema de gestión para gimnasio: membresías, check-in, pagos, reservas de clases,
rutinas de entrenamiento y seguimiento de progreso físico.

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
└── docker-compose.yml
```

## Setup

```bash
cp backend/.env.example backend/.env
docker compose up -d db          # levanta Postgres y corre 001_init.sql
cd backend && npm install && npm run dev
cd frontend && npm install && npm run dev
```

## Roadmap (portafolio)

- [x] **Fase 0** — Modelado de datos y arquitectura (este repo)
- [x] **Fase 1** — Backend base + auth por roles (admin, recepción, entrenador, miembro)
- [x] **Fase 2** — Check-in y control de acceso
- [x] **Fase 3** — Pagos y vencimientos de membresía
- [x] **Fase 4** — Reservas de clases (concurrencia, evitar overbooking)
- [ ] **Fase 5** — Rutinas y catálogo de ejercicios
- [ ] **Fase 6** — Progreso físico (métricas corporales)
- [ ] **Fase 7** — Dashboard de reportes / analytics
- [ ] **Fase 8** — Testing, pulido UI, deploy
- [ ] **Fase 9 (opcional)** — Asistente IA para recomendación de rutinas

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
  es una decisión de negocio que merece su propio grill-me antes de implementarse.
