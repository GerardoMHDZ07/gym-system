// Tests de contrato para la Fase 5 (catálogo de ejercicios y rutinas).
// Decisiones del grill-me de esta fase:
//   - Catálogo de ejercicios: lectura para todo autenticado; admin/recepcion
//     crean y editan; solo admin borra (dato maestral, como classes).
//   - Rutinas: la rutina es un agregado — POST/PUT reciben los ejercicios
//     anidados y la transacción los inserta/reemplaza atómicamente.
//     created_by sale SIEMPRE del token (no del body).
//   - Quién escribe rutinas: entrenador (solo las suyas, 403 si toca otra) y
//     admin/recepcion (cualquiera). Solo admin borra.
//   - Visibilidad: el miembro ve solo las rutinas que le asignaron; el
//     entrenador solo las que creó; admin/recepcion todo (con ?user_id=).
//   - assigned_to debe ser rol 'miembro' (404 inexistente, 400 rol incorrecto,
//     misma convención que memberships.create). No exige membresía activa.
//   - order_index opcional: si no llega, se usa la posición en el array.
//
// Requiere: DB con 002_seed.sql aplicado y backend corriendo en http://127.0.0.1:4000.
// Crea sus propios usuarios/ejercicios/rutinas y los borra al final: no muta el seed.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:4000";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// --- Helpers ---------------------------------------------------------------

async function login(email, password) {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return res.json();
}

async function api(path, { method = "GET", token, body } = {}) {
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return res;
}

const createdUserIds = [];
const createdExerciseIds = [];
const createdRoutineIds = [];

async function createUser(role = "miembro") {
  const email = `routine.test.${Date.now()}.${Math.random().toString(36).slice(2)}@gym.local`;
  const res = await pool.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, 'x', $3) RETURNING id`,
    ["Routine Test", email, role]
  );
  createdUserIds.push(res.rows[0].id);
  return res.rows[0].id;
}

async function userIdByEmail(email) {
  const res = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
  return res.rows[0].id;
}

async function createExercise(token, body = { name: `Ejercicio ${Date.now()}` }) {
  const res = await api("/api/exercises", { method: "POST", token, body });
  assert.equal(res.status, 201, "crear ejercicio de soporte debería funcionar");
  const ex = await res.json();
  createdExerciseIds.push(ex.id);
  return ex;
}

async function createRoutine(token, body) {
  const res = await api("/api/routines", { method: "POST", token, body });
  assert.equal(res.status, 201, "crear rutina de soporte debería funcionar");
  const routine = await res.json();
  createdRoutineIds.push(routine.id);
  return routine;
}

let adminToken, recepcionToken, memberToken, carlaToken, jorgeToken;
let carlaId, miguelId, adminId;

before(async () => {
  adminToken = (await login("admin@gym.local", "demo1234")).token;
  recepcionToken = (await login("recepcion@gym.local", "demo1234")).token;
  memberToken = (await login("miguel@gym.local", "demo1234")).token;
  carlaToken = (await login("carla@gym.local", "demo1234")).token;
  jorgeToken = (await login("jorge@gym.local", "demo1234")).token;
  carlaId = await userIdByEmail("carla@gym.local");
  miguelId = await userIdByEmail("miguel@gym.local");
  adminId = await userIdByEmail("admin@gym.local");
});

after(async () => {
  if (createdRoutineIds.length > 0) {
    await pool.query(`DELETE FROM routines WHERE id = ANY($1::int[])`, [createdRoutineIds]);
  }
  if (createdExerciseIds.length > 0) {
    await pool.query(`DELETE FROM exercises WHERE id = ANY($1::int[])`, [createdExerciseIds]);
  }
  if (createdUserIds.length > 0) {
    await pool.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [createdUserIds]);
  }
  await pool.end();
});

// --- Catálogo de ejercicios -------------------------------------------------

test("GET /api/exercises sin token devuelve 401", async () => {
  const res = await api("/api/exercises");
  assert.equal(res.status, 401);
});

test("GET /api/exercises con token de miembro devuelve el catálogo (200)", async () => {
  const res = await api("/api/exercises", { token: memberToken });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body) && body.length >= 5, "debería incluir los 5 del seed");
});

test("POST /api/exercises como miembro devuelve 403", async () => {
  const res = await api("/api/exercises", { method: "POST", token: memberToken, body: {} });
  assert.equal(res.status, 403);
});

test("POST /api/exercises como recepcion crea el ejercicio (201)", async () => {
  const res = await api("/api/exercises", {
    method: "POST",
    token: recepcionToken,
    body: { name: "Zancadas", muscle_group: "piernas", video_url: "https://example.com/video" },
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  createdExerciseIds.push(body.id);
  assert.equal(body.name, "Zancadas");
  assert.equal(body.muscle_group, "piernas");
  assert.equal(body.video_url, "https://example.com/video");
});

test("POST /api/exercises con name vacío devuelve 400", async () => {
  const res = await api("/api/exercises", { method: "POST", token: adminToken, body: { name: "" } });
  assert.equal(res.status, 400);
});

test("PUT /api/exercises/:id como admin actualiza (200)", async () => {
  const ex = await createExercise(recepcionToken);
  const res = await api(`/api/exercises/${ex.id}`, {
    method: "PUT",
    token: adminToken,
    body: { name: "Zancadas con mancuernas", muscle_group: "piernas" },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.name, "Zancadas con mancuernas");
});

test("DELETE /api/exercises/:id como recepcion devuelve 403; como admin 204", async () => {
  const ex = await createExercise(adminToken);
  const forbidden = await api(`/api/exercises/${ex.id}`, { method: "DELETE", token: recepcionToken });
  assert.equal(forbidden.status, 403);

  const res = await api(`/api/exercises/${ex.id}`, { method: "DELETE", token: adminToken });
  assert.equal(res.status, 204);
});

test("GET /api/exercises/:id inexistente devuelve 404", async () => {
  const res = await api("/api/exercises/999999", { token: memberToken });
  assert.equal(res.status, 404);
});

// --- Rutinas: creación ------------------------------------------------------

test("POST /api/routines sin token devuelve 401", async () => {
  const res = await api("/api/routines", { method: "POST", body: {} });
  assert.equal(res.status, 401);
});

test("POST /api/routines como miembro devuelve 403", async () => {
  const res = await api("/api/routines", { method: "POST", token: memberToken, body: {} });
  assert.equal(res.status, 403);
});

test("POST /api/routines como entrenador crea la rutina con ejercicios anidados (201)", async () => {
  const memberId = await createUser();
  const sentadillaId = (await pool.query(`SELECT id FROM exercises WHERE name = 'Sentadilla'`)).rows[0].id;
  const planchaId = (await pool.query(`SELECT id FROM exercises WHERE name = 'Plancha'`)).rows[0].id;

  const res = await api("/api/routines", {
    method: "POST",
    token: carlaToken,
    body: {
      name: "Pierna y core",
      assigned_to: memberId,
      notes: "2 sesiones por semana",
      exercises: [
        { exercise_id: sentadillaId, sets: 4, reps: 8, rest_seconds: 90 },
        { exercise_id: planchaId, sets: 3, reps: 30 },
      ],
    },
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  createdRoutineIds.push(body.id);
  assert.equal(body.name, "Pierna y core");
  assert.equal(body.created_by, carlaId, "created_by sale del token, no del body");
  assert.equal(body.assigned_to, memberId);
  assert.equal(body.exercises.length, 2);
  // order_index por defecto = posición en el array del body
  assert.deepEqual(body.exercises.map((e) => e.order_index), [0, 1]);
  assert.equal(body.exercises[0].exercise_name, "Sentadilla");
  assert.equal(body.exercises[1].rest_seconds, null);
});

test("POST /api/routines como admin también puede crear (201)", async () => {
  const memberId = await createUser();
  const exerciseId = (await pool.query(`SELECT id FROM exercises LIMIT 1`)).rows[0].id;
  const res = await api("/api/routines", {
    method: "POST",
    token: adminToken,
    body: {
      name: "Rutina del staff",
      assigned_to: memberId,
      exercises: [{ exercise_id: exerciseId, sets: 3, reps: 12 }],
    },
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  createdRoutineIds.push(body.id);
  assert.equal(body.created_by, adminId);
});

test("POST /api/routines con assigned_to que no es miembro devuelve 400", async () => {
  const exerciseId = (await pool.query(`SELECT id FROM exercises LIMIT 1`)).rows[0].id;
  const res = await api("/api/routines", {
    method: "POST",
    token: carlaToken,
    body: {
      name: "Mala",
      assigned_to: adminId,
      exercises: [{ exercise_id: exerciseId, sets: 3, reps: 12 }],
    },
  });
  assert.equal(res.status, 400);
});

test("POST /api/routines con assigned_to inexistente devuelve 404", async () => {
  const exerciseId = (await pool.query(`SELECT id FROM exercises LIMIT 1`)).rows[0].id;
  const res = await api("/api/routines", {
    method: "POST",
    token: carlaToken,
    body: {
      name: "Mala",
      assigned_to: 999999,
      exercises: [{ exercise_id: exerciseId, sets: 3, reps: 12 }],
    },
  });
  assert.equal(res.status, 404);
});

test("POST /api/routines con exercise_id inexistente devuelve 400", async () => {
  const memberId = await createUser();
  const res = await api("/api/routines", {
    method: "POST",
    token: carlaToken,
    body: {
      name: "Mala",
      assigned_to: memberId,
      exercises: [{ exercise_id: 999999, sets: 3, reps: 12 }],
    },
  });
  assert.equal(res.status, 400);
});

test("POST /api/routines con sets inválido devuelve 400", async () => {
  const memberId = await createUser();
  const exerciseId = (await pool.query(`SELECT id FROM exercises LIMIT 1`)).rows[0].id;
  const res = await api("/api/routines", {
    method: "POST",
    token: carlaToken,
    body: {
      name: "Mala",
      assigned_to: memberId,
      exercises: [{ exercise_id: exerciseId, sets: 0, reps: 12 }],
    },
  });
  assert.equal(res.status, 400);
});

// --- Rutinas: lectura -------------------------------------------------------

test("GET /api/routines como miembro devuelve solo SUS rutinas", async () => {
  const res = await api("/api/routines", { token: memberToken });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body) && body.length >= 1, "miguel tiene la rutina del seed");
  for (const r of body) assert.equal(r.assigned_to, miguelId);
});

test("GET /api/routines como entrenador devuelve solo LAS SUYAS", async () => {
  const memberId = await createUser();
  await createRoutine(carlaToken, {
    name: "De Carla",
    assigned_to: memberId,
    exercises: [],
  });

  const res = await api("/api/routines", { token: jorgeToken });
  assert.equal(res.status, 200);
  const body = await res.json();
  // jorge no creó ninguna: solo puede ver las suyas (0 creadas por él en este run)
  for (const r of body) assert.equal(r.created_by, (await userIdByEmail("jorge@gym.local")));
});

test("GET /api/routines/:id incluye los ejercicios anidados", async () => {
  const exerciseId = (await pool.query(`SELECT id FROM exercises WHERE name = 'Peso muerto'`)).rows[0].id;
  // Asignada a miguel (seed) para poder verla con su token: el miembro solo ve
  // el detalle de las rutinas que le asignaron.
  const routine = await createRoutine(carlaToken, {
    name: "Espalda",
    assigned_to: miguelId,
    exercises: [{ exercise_id: exerciseId, sets: 4, reps: 6 }],
  });

  const res = await api(`/api/routines/${routine.id}`, { token: memberToken });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.exercises.length, 1);
  assert.equal(body.exercises[0].exercise_name, "Peso muerto");
  assert.equal(body.exercises[0].sets, 4);
});

test("GET /api/routines/:id de rutina ajena como miembro devuelve 403", async () => {
  const memberId = await createUser();
  const routine = await createRoutine(carlaToken, { name: "Ajena", assigned_to: memberId, exercises: [] });
  const res = await api(`/api/routines/${routine.id}`, { token: memberToken });
  assert.equal(res.status, 403);
});

test("GET /api/routines/:id de rutina de otro entrenador devuelve 403", async () => {
  const memberId = await createUser();
  const routine = await createRoutine(carlaToken, { name: "De Carla", assigned_to: memberId, exercises: [] });
  const res = await api(`/api/routines/${routine.id}`, { token: jorgeToken });
  assert.equal(res.status, 403);

  const asAdmin = await api(`/api/routines/${routine.id}`, { token: adminToken });
  assert.equal(asAdmin.status, 200);
});

test("GET /api/routines como admin con ?user_id= filtra por miembro", async () => {
  const memberId = await createUser();
  await createRoutine(carlaToken, { name: "Para filtro", assigned_to: memberId, exercises: [] });

  const res = await api(`/api/routines?user_id=${memberId}`, { token: adminToken });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.length >= 1);
  for (const r of body) assert.equal(r.assigned_to, memberId);
});

// --- Rutinas: edición y borrado --------------------------------------------

test("PUT /api/routines/:id como entrenador reemplaza los ejercicios (full replace)", async () => {
  const memberId = await createUser();
  const sentadillaId = (await pool.query(`SELECT id FROM exercises WHERE name = 'Sentadilla'`)).rows[0].id;
  const pressId = (await pool.query(`SELECT id FROM exercises WHERE name = 'Press banca'`)).rows[0].id;
  const routine = await createRoutine(carlaToken, {
    name: "Antes",
    assigned_to: memberId,
    exercises: [
      { exercise_id: sentadillaId, sets: 3, reps: 10 },
      { exercise_id: pressId, sets: 3, reps: 10 },
    ],
  });

  const res = await api(`/api/routines/${routine.id}`, {
    method: "PUT",
    token: carlaToken,
    body: {
      name: "Después",
      assigned_to: memberId,
      exercises: [{ exercise_id: pressId, sets: 5, reps: 5 }],
    },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.name, "Después");
  assert.equal(body.exercises.length, 1);
  assert.equal(body.exercises[0].exercise_id, pressId);

  // En la DB solo debe quedar 1 fila de routine_exercises (las viejas se borraron)
  const stored = await pool.query(
    `SELECT count(*)::int AS n FROM routine_exercises WHERE routine_id = $1`,
    [routine.id]
  );
  assert.equal(stored.rows[0].n, 1, "el PUT reemplaza, no acumula");
});

test("PUT /api/routines/:id de otro entrenador devuelve 403", async () => {
  const memberId = await createUser();
  const routine = await createRoutine(carlaToken, { name: "De Carla", assigned_to: memberId, exercises: [] });
  const res = await api(`/api/routines/${routine.id}`, {
    method: "PUT",
    token: jorgeToken,
    body: { name: "Robada", assigned_to: memberId, exercises: [] },
  });
  assert.equal(res.status, 403);
});

test("PUT /api/routines/:id como admin edita cualquier rutina (200)", async () => {
  const memberId = await createUser();
  const routine = await createRoutine(carlaToken, { name: "De Carla", assigned_to: memberId, exercises: [] });
  const res = await api(`/api/routines/${routine.id}`, {
    method: "PUT",
    token: adminToken,
    body: { name: "Editada por admin", assigned_to: memberId, exercises: [] },
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).name, "Editada por admin");
});

test("DELETE /api/routines/:id como recepcion devuelve 403; como admin 204", async () => {
  const memberId = await createUser();
  const routine = await createRoutine(carlaToken, { name: "A borrar", assigned_to: memberId, exercises: [] });

  const forbidden = await api(`/api/routines/${routine.id}`, { method: "DELETE", token: recepcionToken });
  assert.equal(forbidden.status, 403);

  const res = await api(`/api/routines/${routine.id}`, { method: "DELETE", token: adminToken });
  assert.equal(res.status, 204);
});
