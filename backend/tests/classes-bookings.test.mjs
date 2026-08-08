// Tests de contrato para la Fase 4 (CRUD de clases y reservas).
// Decisiones del grill-me de esta fase:
//   - CRUD de clases: admin/recepcion crean y editan; solo admin borra.
//   - Reservas: el miembro reserva self-service (sin user_id); admin/recepcion
//     reservan en nombre de un miembro (con user_id). Siempre se exige membresía
//     activa (403 si no, igual que checkins).
//   - Concurrencia: transacción + SELECT ... FOR UPDATE sobre la fila de la clase;
//     count de 'reservada' >= capacity -> 409. Dos reservas simultáneas por el
//     último cupo: solo una gana.
//   - Cancelación: PUT status='cancelada'; la re-reserva revive la fila cancelada.
//   - No se reservan clases ya comenzadas (409). 'asistio' queda para más adelante.
//
// Requiere: DB con 002_seed.sql aplicado y backend corriendo en http://127.0.0.1:4000.
// Crea usuarios/clases propios y los borra al final: no muta el seed.

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

// Texto esperado para una columna TIMESTAMP guardada en UTC (el server corre UTC).
function tsText(iso) {
  return new Date(iso).toISOString().slice(0, 19).replace("T", " ");
}

const createdUserIds = [];
const createdClassIds = [];

async function createMemberUser(role = "miembro") {
  const email = `booking.test.${Date.now()}.${Math.random().toString(36).slice(2)}@gym.local`;
  const res = await pool.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, 'x', $3) RETURNING id`,
    ["Booking Test", email, role]
  );
  createdUserIds.push(res.rows[0].id);
  return res.rows[0].id;
}

async function createMembership(userId) {
  const planRes = await pool.query(
    `SELECT id FROM membership_plans WHERE name = 'Mensual' LIMIT 1`
  );
  await pool.query(
    `INSERT INTO memberships (user_id, plan_id, start_date, end_date, status)
     VALUES ($1, $2, CURRENT_DATE, CURRENT_DATE + 30::int, 'activa')`,
    [userId, planRes.rows[0].id]
  );
}

async function userIdByEmail(email) {
  const res = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
  return res.rows[0].id;
}

function futureIso(daysFromNow = 7) {
  return new Date(Date.now() + daysFromNow * 86400000).toISOString();
}

// Crea una clase vía la API (admin) y la registra para cleanup.
async function createClass(token, { capacity = 10, startIso = futureIso(), name = "Crossfit" } = {}) {
  const res = await api("/api/classes", {
    method: "POST",
    token,
    body: {
      name,
      trainer_id: carlaId,
      schedule_start: startIso,
      schedule_end: new Date(new Date(startIso).getTime() + 3600000).toISOString(),
      capacity,
    },
  });
  assert.equal(res.status, 201, "crear clase de soporte debería funcionar");
  const cls = await res.json();
  createdClassIds.push(cls.id);
  return cls;
}

let adminToken, recepcionToken, memberToken, danielToken, carlaId;

before(async () => {
  adminToken = (await login("admin@gym.local", "demo1234")).token;
  recepcionToken = (await login("recepcion@gym.local", "demo1234")).token;
  memberToken = (await login("miguel@gym.local", "demo1234")).token;
  danielToken = (await login("daniel@gym.local", "demo1234")).token;
  carlaId = await userIdByEmail("carla@gym.local");
});

after(async () => {
  if (createdClassIds.length > 0) {
    await pool.query(`DELETE FROM classes WHERE id = ANY($1::int[])`, [createdClassIds]);
  }
  if (createdUserIds.length > 0) {
    await pool.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [createdUserIds]);
  }
  await pool.end();
});

// --- CRUD de clases ---------------------------------------------------------

test("GET /api/classes sin token devuelve 401", async () => {
  const res = await api("/api/classes");
  assert.equal(res.status, 401);
});

test("POST /api/classes sin token devuelve 401", async () => {
  const res = await api("/api/classes", { method: "POST", body: {} });
  assert.equal(res.status, 401);
});

test("GET /api/classes con token de miembro devuelve el catálogo (200)", async () => {
  const res = await api("/api/classes", { token: memberToken });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body) && body.length >= 3, "debería incluir las 3 del seed");
});

test("POST /api/classes como miembro devuelve 403", async () => {
  const res = await api("/api/classes", { method: "POST", token: memberToken, body: {} });
  assert.equal(res.status, 403);
});

test("POST /api/classes como admin crea la clase y devuelve el horario en texto UTC", async () => {
  const start = futureIso(10);
  const res = await api("/api/classes", {
    method: "POST",
    token: adminToken,
    body: {
      name: "Pilates",
      trainer_id: carlaId,
      schedule_start: start,
      schedule_end: new Date(new Date(start).getTime() + 3600000).toISOString(),
      capacity: 8,
    },
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  createdClassIds.push(body.id);
  assert.equal(body.name, "Pilates");
  assert.equal(body.capacity, 8);
  // Postgres devuelve el timestamp con milisegundos si no son cero: comparamos hasta los segundos.
  assert.equal(body.schedule_start.slice(0, 19), tsText(start));
  assert.equal(body.schedule_end.slice(0, 19), tsText(new Date(new Date(start).getTime() + 3600000).toISOString()));
});

test("POST /api/classes con trainer que no es entrenador devuelve 400", async () => {
  const miguelId = await userIdByEmail("miguel@gym.local");
  const res = await api("/api/classes", {
    method: "POST",
    token: adminToken,
    body: {
      name: "Mala",
      trainer_id: miguelId,
      schedule_start: futureIso(),
      schedule_end: futureIso(8),
      capacity: 5,
    },
  });
  assert.equal(res.status, 400);
});

test("POST /api/classes con trainer inexistente devuelve 404", async () => {
  const res = await api("/api/classes", {
    method: "POST",
    token: adminToken,
    body: {
      name: "Mala",
      trainer_id: 999999,
      schedule_start: futureIso(),
      schedule_end: futureIso(8),
      capacity: 5,
    },
  });
  assert.equal(res.status, 404);
});

test("POST /api/classes con schedule_end anterior a schedule_start devuelve 400", async () => {
  const start = futureIso();
  const res = await api("/api/classes", {
    method: "POST",
    token: adminToken,
    body: {
      name: "Mala",
      trainer_id: carlaId,
      schedule_start: start,
      schedule_end: new Date(new Date(start).getTime() - 3600000).toISOString(),
      capacity: 5,
    },
  });
  assert.equal(res.status, 400);
});

test("POST /api/classes con capacity inválido devuelve 400", async () => {
  const res = await api("/api/classes", {
    method: "POST",
    token: adminToken,
    body: {
      name: "Mala",
      trainer_id: carlaId,
      schedule_start: futureIso(),
      schedule_end: futureIso(8),
      capacity: 0,
    },
  });
  assert.equal(res.status, 400);
});

test("PUT /api/classes/:id como recepcion actualiza la clase (200)", async () => {
  const cls = await createClass(adminToken);
  const res = await api(`/api/classes/${cls.id}`, {
    method: "PUT",
    token: recepcionToken,
    body: {
      name: "Crossfit Avanzado",
      trainer_id: carlaId,
      schedule_start: futureIso(12),
      schedule_end: futureIso(13),
      capacity: 20,
    },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.name, "Crossfit Avanzado");
  assert.equal(body.capacity, 20);
});

test("PUT /api/classes/:id inexistente devuelve 404", async () => {
  const res = await api(`/api/classes/999999`, {
    method: "PUT",
    token: adminToken,
    body: {
      name: "X",
      trainer_id: carlaId,
      schedule_start: futureIso(),
      schedule_end: futureIso(8),
      capacity: 5,
    },
  });
  assert.equal(res.status, 404);
});

test("DELETE /api/classes/:id como recepcion devuelve 403; como admin 204", async () => {
  const cls = await createClass(adminToken);
  const forbidden = await api(`/api/classes/${cls.id}`, {
    method: "DELETE",
    token: recepcionToken,
  });
  assert.equal(forbidden.status, 403);

  const res = await api(`/api/classes/${cls.id}`, { method: "DELETE", token: adminToken });
  assert.equal(res.status, 204);
});

// --- Reservas: creación -----------------------------------------------------

test("POST /api/bookings sin token devuelve 401", async () => {
  const res = await api("/api/bookings", { method: "POST", body: {} });
  assert.equal(res.status, 401);
});

test("POST /api/bookings como miembro con membresía vencida devuelve 403", async () => {
  const cls = await createClass(adminToken);
  const res = await api("/api/bookings", {
    method: "POST",
    token: danielToken,
    body: { class_id: cls.id },
  });
  assert.equal(res.status, 403);
});

test("POST /api/bookings como miembro activo reserva (201)", async () => {
  const cls = await createClass(adminToken);
  const res = await api("/api/bookings", {
    method: "POST",
    token: memberToken,
    body: { class_id: cls.id },
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.status, "reservada");
  assert.equal(body.class_id, cls.id);
  assert.equal(body.user_id, await userIdByEmail("miguel@gym.local"));
});

test("POST /api/bookings duplicado del mismo miembro en la misma clase devuelve 409", async () => {
  const cls = await createClass(adminToken);
  const first = await api("/api/bookings", {
    method: "POST",
    token: memberToken,
    body: { class_id: cls.id },
  });
  assert.equal(first.status, 201);

  const dup = await api("/api/bookings", {
    method: "POST",
    token: memberToken,
    body: { class_id: cls.id },
  });
  assert.equal(dup.status, 409);
});

test("POST /api/bookings en clase llena devuelve 409", async () => {
  const cls = await createClass(adminToken, { capacity: 1 });
  const first = await api("/api/bookings", {
    method: "POST",
    token: memberToken,
    body: { class_id: cls.id },
  });
  assert.equal(first.status, 201);

  // sofia tiene membresía activa, así que llega al check de cupo (y la clase está llena)
  const sofiaToken = (await login("sofia@gym.local", "demo1234")).token;
  const second = await api("/api/bookings", {
    method: "POST",
    token: sofiaToken,
    body: { class_id: cls.id },
  });
  assert.equal(second.status, 409);
});

test("POST /api/bookings como recepcion con user_id reserva en nombre del miembro (201)", async () => {
  const cls = await createClass(adminToken);
  const uid = await createMemberUser();
  await createMembership(uid);

  const res = await api("/api/bookings", {
    method: "POST",
    token: recepcionToken,
    body: { class_id: cls.id, user_id: uid },
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.user_id, uid);
});

test("POST /api/bookings como recepcion sin user_id devuelve 400", async () => {
  const cls = await createClass(adminToken);
  const res = await api("/api/bookings", {
    method: "POST",
    token: recepcionToken,
    body: { class_id: cls.id },
  });
  assert.equal(res.status, 400);
});

test("POST /api/bookings como staff para usuario sin membresía activa devuelve 403", async () => {
  const cls = await createClass(adminToken);
  const danielId = await userIdByEmail("daniel@gym.local");
  const res = await api("/api/bookings", {
    method: "POST",
    token: adminToken,
    body: { class_id: cls.id, user_id: danielId },
  });
  assert.equal(res.status, 403);
});

test("POST /api/bookings en clase ya comenzada devuelve 409", async () => {
  const cls = await createClass(adminToken, { startIso: new Date(Date.now() - 3600000).toISOString() });
  const res = await api("/api/bookings", {
    method: "POST",
    token: memberToken,
    body: { class_id: cls.id },
  });
  assert.equal(res.status, 409);
});

test("POST /api/bookings con clase inexistente devuelve 404", async () => {
  const res = await api("/api/bookings", {
    method: "POST",
    token: memberToken,
    body: { class_id: 999999 },
  });
  assert.equal(res.status, 404);
});

// --- Reservas: lectura ------------------------------------------------------

test("GET /api/bookings como miembro devuelve solo SUS reservas", async () => {
  const miguelId = await userIdByEmail("miguel@gym.local");
  const res = await api("/api/bookings", { token: memberToken });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body) && body.length >= 1, "miguel tiene la reserva del seed");
  for (const b of body) assert.equal(b.user_id, miguelId);
});

test("GET /api/bookings como admin con ?user_id= filtra por miembro", async () => {
  const uid = await createMemberUser();
  await createMembership(uid);
  const cls = await createClass(adminToken);
  const booked = await api("/api/bookings", {
    method: "POST",
    token: adminToken,
    body: { class_id: cls.id, user_id: uid },
  });
  assert.equal(booked.status, 201);

  const res = await api(`/api/bookings?user_id=${uid}`, { token: adminToken });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.length >= 1);
  for (const b of body) assert.equal(b.user_id, uid);
});

test("GET /api/bookings como admin con ?class_id= filtra por clase", async () => {
  const uid = await createMemberUser();
  await createMembership(uid);
  const cls = await createClass(adminToken);
  const booked = await api("/api/bookings", {
    method: "POST",
    token: adminToken,
    body: { class_id: cls.id, user_id: uid },
  });
  assert.equal(booked.status, 201);

  const res = await api(`/api/bookings?class_id=${cls.id}`, { token: adminToken });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.length === 1);
  assert.equal(body[0].class_id, cls.id);
  assert.equal(body[0].class_name, "Crossfit");
});

test("GET /api/bookings/:id de otro miembro devuelve 403", async () => {
  const cls = await createClass(adminToken);
  const sofiaId = await userIdByEmail("sofia@gym.local");
  const booking = await api("/api/bookings", {
    method: "POST",
    token: adminToken,
    body: { class_id: cls.id, user_id: sofiaId },
  });
  assert.equal(booking.status, 201);
  const bookingBody = await booking.json();

  const res = await api(`/api/bookings/${bookingBody.id}`, { token: memberToken });
  assert.equal(res.status, 403);

  const asAdmin = await api(`/api/bookings/${bookingBody.id}`, { token: adminToken });
  assert.equal(asAdmin.status, 200);
});

// --- Reservas: cancelación y re-reserva ------------------------------------

test("PUT /api/bookings/:id cancela la propia reserva (200)", async () => {
  const cls = await createClass(adminToken);
  const booked = await api("/api/bookings", {
    method: "POST",
    token: memberToken,
    body: { class_id: cls.id },
  });
  const booking = await booked.json();

  const res = await api(`/api/bookings/${booking.id}`, {
    method: "PUT",
    token: memberToken,
    body: { status: "cancelada" },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "cancelada");
});

test("PUT /api/bookings/:id como admin cancela la reserva de otro miembro (200)", async () => {
  const cls = await createClass(adminToken);
  const sofiaId = await userIdByEmail("sofia@gym.local");
  const booked = await api("/api/bookings", {
    method: "POST",
    token: adminToken,
    body: { class_id: cls.id, user_id: sofiaId },
  });
  const booking = await booked.json();

  const res = await api(`/api/bookings/${booking.id}`, {
    method: "PUT",
    token: adminToken,
    body: { status: "cancelada" },
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, "cancelada");
});

test("PUT /api/bookings/:id cancelar la reserva de otro miembro devuelve 403", async () => {
  const cls = await createClass(adminToken);
  const sofiaId = await userIdByEmail("sofia@gym.local");
  const booked = await api("/api/bookings", {
    method: "POST",
    token: adminToken,
    body: { class_id: cls.id, user_id: sofiaId },
  });
  const booking = await booked.json();

  const res = await api(`/api/bookings/${booking.id}`, {
    method: "PUT",
    token: memberToken,
    body: { status: "cancelada" },
  });
  assert.equal(res.status, 403);
});

test("cancelar una reserva ya cancelada devuelve 409", async () => {
  const cls = await createClass(adminToken);
  const booked = await api("/api/bookings", {
    method: "POST",
    token: memberToken,
    body: { class_id: cls.id },
  });
  const booking = await booked.json();

  await api(`/api/bookings/${booking.id}`, {
    method: "PUT",
    token: memberToken,
    body: { status: "cancelada" },
  });
  const res = await api(`/api/bookings/${booking.id}`, {
    method: "PUT",
    token: memberToken,
    body: { status: "cancelada" },
  });
  assert.equal(res.status, 409);
});

test("re-reservar tras cancelar revive la misma fila (201)", async () => {
  const cls = await createClass(adminToken);
  const booked = await api("/api/bookings", {
    method: "POST",
    token: memberToken,
    body: { class_id: cls.id },
  });
  const booking = await booked.json();

  await api(`/api/bookings/${booking.id}`, {
    method: "PUT",
    token: memberToken,
    body: { status: "cancelada" },
  });

  const again = await api("/api/bookings", {
    method: "POST",
    token: memberToken,
    body: { class_id: cls.id },
  });
  assert.equal(again.status, 201);
  const revived = await again.json();
  assert.equal(revived.id, booking.id, "se revive la fila cancelada, no un INSERT nuevo");
  assert.equal(revived.status, "reservada");
});

test("DELETE /api/bookings/:id como recepcion devuelve 403; como admin 204", async () => {
  const cls = await createClass(adminToken);
  const booked = await api("/api/bookings", {
    method: "POST",
    token: memberToken,
    body: { class_id: cls.id },
  });
  const booking = await booked.json();

  const forbidden = await api(`/api/bookings/${booking.id}`, {
    method: "DELETE",
    token: recepcionToken,
  });
  assert.equal(forbidden.status, 403);

  const res = await api(`/api/bookings/${booking.id}`, { method: "DELETE", token: adminToken });
  assert.equal(res.status, 204);
});

// --- Concurrencia: el corazón de la Fase 4 ---------------------------------

test("concurrencia: 3 reservas simultáneas por el último cupo — solo una gana (1×201, 2×409)", async () => {
  const cls = await createClass(adminToken, { capacity: 1 });
  const users = [await createMemberUser(), await createMemberUser(), await createMemberUser()];
  for (const uid of users) await createMembership(uid);

  // Staff reserva en nombre de 3 miembros distintos, al mismo tiempo.
  const results = await Promise.all(
    users.map((uid) =>
      api("/api/bookings", {
        method: "POST",
        token: adminToken,
        body: { class_id: cls.id, user_id: uid },
      })
    )
  );

  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [201, 409, 409], "solo una reserva puede ganar el cupo");

  const stored = await pool.query(
    `SELECT count(*)::int AS n FROM class_bookings
     WHERE class_id = $1 AND status = 'reservada'`,
    [cls.id]
  );
  assert.equal(stored.rows[0].n, 1, "en la DB solo debe quedar una reserva 'reservada'");
});
