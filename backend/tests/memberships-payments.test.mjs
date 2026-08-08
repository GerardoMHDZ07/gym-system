// Tests de contrato para la Fase 3 (pagos y vencimientos de membresía).
// Validan el comportamiento de la API según las decisiones del grill-me:
//   - Vencimiento: materialización perezosa al leer (end_date pasado + 'activa' -> 'vencida').
//   - POST /api/payments registra el pago Y renueva la membresía (activa: extiende
//     desde end_date; vencida: reactiva desde hoy; cancelada: 409).
//   - Admin/recepcion gestionan todo; el miembro solo ve SUS propios pagos/membresías.
//   - Sin PUT ni DELETE en payments: un pago es un evento financiero inmutable (ledger).
//     PUT solo admin para cancelar membresías; DELETE de membresías solo admin.
//
// Requiere: DB con 002_seed.sql aplicado y backend corriendo en http://127.0.0.1:4000.
// Los tests crean usuarios propios (vía SQL) y los borran al final: no mutan el seed,
// así no interfieren con los otros archivos de test que corre node --test en paralelo.

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

// Crea un usuario miembro nuevo directamente en la DB (para no contaminar el seed).
async function createMemberUser(role = "miembro") {
  const email = `billing.test.${Date.now()}.${Math.random()
    .toString(36)
    .slice(2)}@gym.local`;
  const res = await pool.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, 'x', $3) RETURNING id`,
    ["Billing Test", email, role]
  );
  createdUserIds.push(res.rows[0].id);
  return res.rows[0].id;
}

// Crea una membresía Mensual (30 días) para un usuario, con estado y fin configurable.
async function createMembership(userId, { status = "activa", endDaysFromToday = 30 } = {}) {
  const planRes = await pool.query(
    `SELECT id, duration_days FROM membership_plans WHERE name = 'Mensual' LIMIT 1`
  );
  const plan = planRes.rows[0];
  const res = await pool.query(
    `INSERT INTO memberships (user_id, plan_id, start_date, end_date, status)
     VALUES ($1, $2, CURRENT_DATE, CURRENT_DATE + $3::int, $4)
     RETURNING id, end_date, status`,
    [userId, plan.id, endDaysFromToday, status]
  );
  return { membershipId: res.rows[0].id, plan };
}

// Fuerza el end_date de una membresía al pasado (para probar materialización/vencimiento).
async function forceExpired(membershipId) {
  await pool.query(
    `UPDATE memberships SET end_date = CURRENT_DATE - 1, status = 'activa' WHERE id = $1`,
    [membershipId]
  );
}

// Fecha esperada "hoy + n días" en la misma zona horaria del server (UTC).
async function dateInDays(n) {
  const res = await pool.query(`SELECT (CURRENT_DATE + $1::int)::text AS d`, [n]);
  return res.rows[0].d;
}

let adminToken, recepcionToken, memberToken, trainerToken;

before(async () => {
  adminToken = (await login("admin@gym.local", "demo1234")).token;
  recepcionToken = (await login("recepcion@gym.local", "demo1234")).token;
  memberToken = (await login("miguel@gym.local", "demo1234")).token;
  trainerToken = (await login("carla@gym.local", "demo1234")).token;
});

after(async () => {
  // Borra los usuarios creados por los tests (memberships/payments cascaden).
  if (createdUserIds.length > 0) {
    await pool.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [createdUserIds]);
  }
  await pool.end();
});

// --- Auth base --------------------------------------------------------------

test("GET /api/memberships sin token devuelve 401", async () => {
  const res = await api("/api/memberships");
  assert.equal(res.status, 401);
});

test("POST /api/payments sin token devuelve 401", async () => {
  const res = await api("/api/payments", { method: "POST", body: {} });
  assert.equal(res.status, 401);
});

test("GET /api/memberships con token de entrenador devuelve 403", async () => {
  const res = await api("/api/memberships", { token: trainerToken });
  assert.equal(res.status, 403);
});

// --- Membresías: lectura y materialización perezosa ---------------------------

test("GET /api/memberships como admin devuelve las membresías del seed", async () => {
  const res = await api("/api/memberships", { token: adminToken });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body));
  assert.ok(body.length >= 3, "debería incluir al menos las 3 del seed");
  const miguelId = await userIdByEmail("miguel@gym.local");
  const miguel = body.find((m) => m.user_id === miguelId);
  assert.ok(miguel);
  assert.equal(miguel.status, "activa");
});

test("GET /api/memberships?user_id= filtra por miembro", async () => {
  const danielId = await userIdByEmail("daniel@gym.local");
  const res = await api(`/api/memberships?user_id=${danielId}`, { token: adminToken });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body) && body.length === 1);
  assert.equal(body[0].user_id, danielId);
  assert.equal(body[0].status, "vencida");
});

test("la materialización perezosa marca 'vencida' al leer una membresía con end_date pasado", async () => {
  const userId = await createMemberUser();
  const { membershipId } = await createMembership(userId, { endDaysFromToday: 30 });
  await forceExpired(membershipId);

  const res = await api(`/api/memberships/${membershipId}`, { token: adminToken });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "vencida");

  // El estado materializado quedó persistido en la DB (lazy write-through)
  const stored = await pool.query(`SELECT status FROM memberships WHERE id = $1`, [
    membershipId,
  ]);
  assert.equal(stored.rows[0].status, "vencida");
});

test("un miembro solo ve SUS propias membresías", async () => {
  const miguelId = await userIdByEmail("miguel@gym.local");
  const res = await api("/api/memberships", { token: memberToken });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body) && body.length > 0);
  for (const m of body) {
    assert.equal(m.user_id, miguelId);
  }
});

test("un miembro no puede ver la membresía de otro miembro (403)", async () => {
  const sofiaId = await userIdByEmail("sofia@gym.local");
  const sofiaMembership = await pool.query(
    `SELECT id FROM memberships WHERE user_id = $1 LIMIT 1`,
    [sofiaId]
  );
  const res = await api(`/api/memberships/${sofiaMembership.rows[0].id}`, {
    token: memberToken,
  });
  assert.equal(res.status, 403);
});

test("un miembro puede ver su propia membresía por id (200)", async () => {
  const miguelId = await userIdByEmail("miguel@gym.local");
  const miguelMembership = await pool.query(
    `SELECT id FROM memberships WHERE user_id = $1 LIMIT 1`,
    [miguelId]
  );
  const res = await api(`/api/memberships/${miguelMembership.rows[0].id}`, {
    token: memberToken,
  });
  assert.equal(res.status, 200);
});

// --- Membresías: creación -----------------------------------------------------

test("POST /api/memberships como recepcion crea una membresía activa de 30 días (plan Mensual)", async () => {
  const userId = await createMemberUser();
  const res = await api("/api/memberships", {
    method: "POST",
    token: recepcionToken,
    body: { user_id: userId, plan_id: 1 },
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.status, "activa");
  assert.equal(body.start_date, await dateInDays(0));
  assert.equal(body.end_date, await dateInDays(30));
});

test("POST /api/memberships con plan inexistente devuelve 404", async () => {
  const userId = await createMemberUser();
  const res = await api("/api/memberships", {
    method: "POST",
    token: adminToken,
    body: { user_id: userId, plan_id: 999999 },
  });
  assert.equal(res.status, 404);
});

test("POST /api/memberships con user inexistente devuelve 404", async () => {
  const res = await api("/api/memberships", {
    method: "POST",
    token: adminToken,
    body: { user_id: 999999, plan_id: 1 },
  });
  assert.equal(res.status, 404);
});

test("POST /api/memberships para un usuario con membresía activa devuelve 409", async () => {
  const miguelId = await userIdByEmail("miguel@gym.local");
  const res = await api("/api/memberships", {
    method: "POST",
    token: adminToken,
    body: { user_id: miguelId, plan_id: 1 },
  });
  assert.equal(res.status, 409);
});

test("POST /api/memberships para un usuario que no es miembro devuelve 400", async () => {
  const trainerId = await createMemberUser("entrenador");
  const res = await api("/api/memberships", {
    method: "POST",
    token: adminToken,
    body: { user_id: trainerId, plan_id: 1 },
  });
  assert.equal(res.status, 400);
});

test("POST /api/memberships como entrenador devuelve 403", async () => {
  const res = await api("/api/memberships", {
    method: "POST",
    token: trainerToken,
    body: { user_id: 1, plan_id: 1 },
  });
  assert.equal(res.status, 403);
});

// --- Membresías: cancelación y borrado ---------------------------------------

test("PUT /api/memberships/:id cancela una membresía activa (solo admin)", async () => {
  const userId = await createMemberUser();
  const { membershipId } = await createMembership(userId);
  const res = await api(`/api/memberships/${membershipId}`, {
    method: "PUT",
    token: adminToken,
    body: { status: "cancelada" },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "cancelada");
});

test("cancelar una membresía ya cancelada devuelve 409", async () => {
  const userId = await createMemberUser();
  const { membershipId } = await createMembership(userId);
  await api(`/api/memberships/${membershipId}`, {
    method: "PUT",
    token: adminToken,
    body: { status: "cancelada" },
  });
  const res = await api(`/api/memberships/${membershipId}`, {
    method: "PUT",
    token: adminToken,
    body: { status: "cancelada" },
  });
  assert.equal(res.status, 409);
});

test("cancelar una membresía vencida devuelve 409 (ya está inactiva)", async () => {
  const userId = await createMemberUser();
  const { membershipId } = await createMembership(userId);
  await forceExpired(membershipId);
  const res = await api(`/api/memberships/${membershipId}`, {
    method: "PUT",
    token: adminToken,
    body: { status: "cancelada" },
  });
  assert.equal(res.status, 409);
});

test("PUT /api/memberships/:id como recepcion devuelve 403", async () => {
  const userId = await createMemberUser();
  const { membershipId } = await createMembership(userId);
  const res = await api(`/api/memberships/${membershipId}`, {
    method: "PUT",
    token: recepcionToken,
    body: { status: "cancelada" },
  });
  assert.equal(res.status, 403);
});

test("PUT /api/memberships/:id con body inválido devuelve 400", async () => {
  const userId = await createMemberUser();
  const { membershipId } = await createMembership(userId);
  const res = await api(`/api/memberships/${membershipId}`, {
    method: "PUT",
    token: adminToken,
    body: { status: "activa" },
  });
  assert.equal(res.status, 400);
});

test("DELETE /api/memberships/:id como admin borra (204); como recepcion 403", async () => {
  const userId = await createMemberUser();
  const { membershipId } = await createMembership(userId);
  const res = await api(`/api/memberships/${membershipId}`, {
    method: "DELETE",
    token: adminToken,
  });
  assert.equal(res.status, 204);

  const other = await createMembership(userId);
  const forbidden = await api(`/api/memberships/${other.membershipId}`, {
    method: "DELETE",
    token: recepcionToken,
  });
  assert.equal(forbidden.status, 403);
});

// --- Pagos: registro y renovación ---------------------------------------------

test("POST /api/payments sobre membresía activa registra el pago y extiende la membresía", async () => {
  const userId = await createMemberUser();
  const { membershipId, plan } = await createMembership(userId, { endDaysFromToday: 10 });

  const res = await api("/api/payments", {
    method: "POST",
    token: adminToken,
    body: { membership_id: membershipId, amount: 450, method: "tarjeta" },
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.ok(body.payment.id);
  assert.equal(body.payment.status, "completado");
  // Renovación desde activa: end_date += duration_days del plan (sin solaparse)
  assert.equal(body.membership.status, "activa");
  assert.equal(body.membership.end_date, await dateInDays(10 + plan.duration_days));
});

test("POST /api/payments sobre membresía vencida la reactiva desde hoy", async () => {
  const userId = await createMemberUser();
  const { membershipId, plan } = await createMembership(userId);
  await forceExpired(membershipId);

  const res = await api("/api/payments", {
    method: "POST",
    token: recepcionToken,
    body: { membership_id: membershipId, amount: 450, method: "efectivo" },
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.membership.status, "activa");
  assert.equal(body.membership.end_date, await dateInDays(plan.duration_days));
});

test("POST /api/payments sobre membresía cancelada devuelve 409", async () => {
  const userId = await createMemberUser();
  const { membershipId } = await createMembership(userId);
  await api(`/api/memberships/${membershipId}`, {
    method: "PUT",
    token: adminToken,
    body: { status: "cancelada" },
  });

  const res = await api("/api/payments", {
    method: "POST",
    token: adminToken,
    body: { membership_id: membershipId, amount: 450, method: "tarjeta" },
  });
  assert.equal(res.status, 409);
});

test("POST /api/payments con membership inexistente devuelve 404", async () => {
  const res = await api("/api/payments", {
    method: "POST",
    token: adminToken,
    body: { membership_id: 999999, amount: 450, method: "tarjeta" },
  });
  assert.equal(res.status, 404);
});

test("POST /api/payments con amount o method inválido devuelve 400", async () => {
  const userId = await createMemberUser();
  const { membershipId } = await createMembership(userId);

  const badAmount = await api("/api/payments", {
    method: "POST",
    token: adminToken,
    body: { membership_id: membershipId, amount: -10, method: "tarjeta" },
  });
  assert.equal(badAmount.status, 400);

  const badMethod = await api("/api/payments", {
    method: "POST",
    token: adminToken,
    body: { membership_id: membershipId, amount: 450, method: "bitcoin" },
  });
  assert.equal(badMethod.status, 400);
});

test("POST /api/payments como entrenador o miembro devuelve 403", async () => {
  const userId = await createMemberUser();
  const { membershipId } = await createMembership(userId);
  const body = { membership_id: membershipId, amount: 450, method: "tarjeta" };

  const asTrainer = await api("/api/payments", {
    method: "POST",
    token: trainerToken,
    body,
  });
  assert.equal(asTrainer.status, 403);

  const asMember = await api("/api/payments", {
    method: "POST",
    token: memberToken,
    body,
  });
  assert.equal(asMember.status, 403);
});

// --- Pagos: lectura -------------------------------------------------------------

test("GET /api/payments como admin devuelve la lista; ?user_id= filtra", async () => {
  const res = await api("/api/payments", { token: adminToken });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body) && body.length >= 3, "debería incluir los 3 del seed");

  const miguelId = await userIdByEmail("miguel@gym.local");
  const filtered = await api(`/api/payments?user_id=${miguelId}`, { token: adminToken });
  assert.equal(filtered.status, 200);
  const filteredBody = await filtered.json();
  assert.ok(filteredBody.length >= 1);
  for (const p of filteredBody) assert.equal(p.user_id, miguelId);
});

test("un miembro solo ve SUS pagos; no los de otro", async () => {
  const miguelId = await userIdByEmail("miguel@gym.local");
  const res = await api("/api/payments", { token: memberToken });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body) && body.length >= 1);
  for (const p of body) {
    assert.equal(p.user_id, miguelId);
  }

  // El pago de sofia no debe ser visible para miguel
  const sofiaId = await userIdByEmail("sofia@gym.local");
  const sofiaPayment = await pool.query(
    `SELECT p.id FROM payments p
     JOIN memberships m ON m.id = p.membership_id
     WHERE m.user_id = $1 LIMIT 1`,
    [sofiaId]
  );
  const forbidden = await api(`/api/payments/${sofiaPayment.rows[0].id}`, {
    token: memberToken,
  });
  assert.equal(forbidden.status, 403);
});

test("GET /api/payments/:id como admin devuelve 200", async () => {
  const res = await api("/api/payments", { token: adminToken });
  const body = await res.json();
  const one = await api(`/api/payments/${body[0].id}`, { token: adminToken });
  assert.equal(one.status, 200);
});

// --- Pagos: inmutabilidad (ledger) ----------------------------------------------

test("DELETE /api/payments/:id no existe como operación (los pagos son inmutables)", async () => {
  const userId = await createMemberUser();
  const { membershipId } = await createMembership(userId);
  const created = await api("/api/payments", {
    method: "POST",
    token: adminToken,
    body: { membership_id: membershipId, amount: 450, method: "tarjeta" },
  });
  const payment = (await created.json()).payment;

  const del = await api(`/api/payments/${payment.id}`, {
    method: "DELETE",
    token: adminToken,
  });
  assert.equal(del.status, 404);

  // El pago sigue existiendo tras el intento de borrado (ledger inmutable)
  const stillThere = await api(`/api/payments/${payment.id}`, { token: adminToken });
  assert.equal(stillThere.status, 200);
});

// Helper local al final (evita forward reference en el top-level de los tests)
async function userIdByEmail(email) {
  const res = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
  return res.rows[0].id;
}
