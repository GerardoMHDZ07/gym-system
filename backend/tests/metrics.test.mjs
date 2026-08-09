// Tests de contrato para la Fase 6 (progreso físico / métricas corporales).
// Decisiones del grill-me de esta fase:
//   - Una medición por día calendario por miembro: POST con una fecha que ya
//     tiene medición -> 409. La fecha se fija al crear; PUT solo corrige valores.
//   - Quién registra/edita: el miembro self-service con su token (el user_id del
//     body se IGNORA para miembros, no se puede falsificar); admin/recepcion/
//     entrenador registran en nombre de un miembro (con user_id; sin él -> 400).
//   - Visibilidad: el miembro solo ve SUS métricas (403 si ve la de otro); el
//     staff ve todas con ?user_id= opcional. Serie ascendente por fecha.
//   - date opcional (por defecto hoy, formato 'YYYY-MM-DD'); fecha futura -> 400.
//   - weight_kg/body_fat_pct opcionales individualmente, al menos uno obligatorio;
//     rangos NUMERIC(5,2)/NUMERIC(4,2). Se devuelven como número (cast float8),
//     no como string (pg devuelve NUMERIC como string por defecto).
//   - DELETE solo admin (corregir errores de registro).
//
// Requiere: DB con 002_seed.sql aplicado y backend corriendo en http://127.0.0.1:4000.
// Crea sus propios usuarios/mediciones y los borra al final: no muta el seed.

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

// Fechas en UTC (el server corre UTC): formato 'YYYY-MM-DD'.
function daysFromNowIso(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const todayIso = () => daysFromNowIso(0);

const createdUserIds = [];
const createdMetricIds = [];

async function createUser(role = "miembro") {
  const email = `metrics.test.${Date.now()}.${Math.random().toString(36).slice(2)}@gym.local`;
  const res = await pool.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, 'x', $3) RETURNING id`,
    ["Metrics Test", email, role]
  );
  createdUserIds.push(res.rows[0].id);
  return res.rows[0].id;
}

async function userIdByEmail(email) {
  const res = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
  return res.rows[0].id;
}

// Registra una medición vía la API y la trackea para cleanup.
async function createMetric(token, body) {
  const res = await api("/api/metrics", { method: "POST", token, body });
  assert.equal(res.status, 201, "crear medición de soporte debería funcionar");
  const metric = await res.json();
  createdMetricIds.push(metric.id);
  return metric;
}

let adminToken, recepcionToken, memberToken, sofiaToken, carlaToken;
let miguelId, sofiaId;

before(async () => {
  adminToken = (await login("admin@gym.local", "demo1234")).token;
  recepcionToken = (await login("recepcion@gym.local", "demo1234")).token;
  memberToken = (await login("miguel@gym.local", "demo1234")).token;
  sofiaToken = (await login("sofia@gym.local", "demo1234")).token;
  carlaToken = (await login("carla@gym.local", "demo1234")).token;
  miguelId = await userIdByEmail("miguel@gym.local");
  sofiaId = await userIdByEmail("sofia@gym.local");
});

after(async () => {
  if (createdMetricIds.length > 0) {
    await pool.query(`DELETE FROM body_metrics WHERE id = ANY($1::int[])`, [createdMetricIds]);
  }
  if (createdUserIds.length > 0) {
    await pool.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [createdUserIds]);
  }
  await pool.end();
});

// --- Auth y lectura --------------------------------------------------------

test("GET /api/metrics sin token devuelve 401", async () => {
  const res = await api("/api/metrics");
  assert.equal(res.status, 401);
});

test("POST /api/metrics sin token devuelve 401", async () => {
  const res = await api("/api/metrics", { method: "POST", body: {} });
  assert.equal(res.status, 401);
});

test("GET /api/metrics como miembro devuelve solo SUS métricas, ordenadas por fecha", async () => {
  const res = await api("/api/metrics", { token: memberToken });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body) && body.length >= 2, "miguel tiene las 2 del seed");
  for (const m of body) assert.equal(m.user_id, miguelId);
  const dates = body.map((m) => m.date);
  assert.deepEqual(dates, [...dates].sort(), "serie ascendente por fecha");
});

test("GET /api/metrics como admin con ?user_id= filtra por miembro", async () => {
  const uid = await createUser();
  await createMetric(adminToken, { user_id: uid, weight_kg: 70.2 });

  const res = await api(`/api/metrics?user_id=${uid}`, { token: adminToken });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.length === 1);
  assert.equal(body[0].user_id, uid);
  assert.equal(typeof body[0].weight_kg, "number", "weight_kg debe venir como número, no string");
});

test("GET /api/metrics/:id de otro miembro devuelve 403; como admin 200", async () => {
  // Fecha pasada a propósito: si se usara "hoy", chocaría con el test de
  // "POST sin fecha usa hoy" (una por día). El seed tampoco toca a sofia.
  const metric = await createMetric(adminToken, { user_id: sofiaId, date: daysFromNowIso(-10), body_fat_pct: 21.5 });

  const forbidden = await api(`/api/metrics/${metric.id}`, { token: memberToken });
  assert.equal(forbidden.status, 403);

  const asAdmin = await api(`/api/metrics/${metric.id}`, { token: adminToken });
  assert.equal(asAdmin.status, 200);
  assert.equal((await asAdmin.json()).body_fat_pct, 21.5);
});

// --- Creación --------------------------------------------------------------

test("POST /api/metrics como miembro sin fecha usa hoy y no puede falsificar user_id", async () => {
  // sofia no tiene métricas en el seed: sin fecha -> fecha de hoy (201).
  // El user_id del body se ignora: la medición queda para sofia, no para miguel.
  const res = await api("/api/metrics", {
    method: "POST",
    token: sofiaToken,
    body: { user_id: miguelId, weight_kg: 62.3, body_fat_pct: 19.9 },
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  createdMetricIds.push(body.id);
  assert.equal(body.user_id, sofiaId, "el miembro se mide para sí mismo");
  assert.equal(body.date, todayIso(), "date por defecto = hoy");
  assert.equal(body.weight_kg, 62.3);
  assert.equal(typeof body.weight_kg, "number");
});

test("POST /api/metrics duplicado en la misma fecha devuelve 409 (una por día)", async () => {
  const date = daysFromNowIso(-2);
  const first = await createMetric(adminToken, { user_id: miguelId, date, weight_kg: 79.5 });

  const dup = await api("/api/metrics", {
    method: "POST",
    token: adminToken,
    body: { user_id: miguelId, date, body_fat_pct: 22.1 },
  });
  assert.equal(dup.status, 409);

  // Y también como el propio miembro con su token
  const dupSelf = await api("/api/metrics", {
    method: "POST",
    token: memberToken,
    body: { date, weight_kg: 79.9 },
  });
  assert.equal(dupSelf.status, 409);
});

test("POST /api/metrics con fecha futura devuelve 400", async () => {
  const res = await api("/api/metrics", {
    method: "POST",
    token: memberToken,
    body: { date: daysFromNowIso(2), weight_kg: 80 },
  });
  assert.equal(res.status, 400);
});

test("POST /api/metrics como miembro con fecha pasada registra (201)", async () => {
  const date = daysFromNowIso(-5);
  const res = await api("/api/metrics", {
    method: "POST",
    token: memberToken,
    body: { date, weight_kg: 81.2, notes: "post desayuno" },
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  createdMetricIds.push(body.id);
  assert.equal(body.date, date);
  assert.equal(body.notes, "post desayuno");
  assert.match(body.date, /^\d{4}-\d{2}-\d{2}$/, "date se devuelve como texto YYYY-MM-DD");
});

test("POST /api/metrics como admin sin user_id devuelve 400", async () => {
  const res = await api("/api/metrics", {
    method: "POST",
    token: adminToken,
    body: { weight_kg: 75 },
  });
  assert.equal(res.status, 400);
});

test("POST /api/metrics como admin para usuario inexistente devuelve 404", async () => {
  const res = await api("/api/metrics", {
    method: "POST",
    token: adminToken,
    body: { user_id: 999999, weight_kg: 75 },
  });
  assert.equal(res.status, 404);
});

test("POST /api/metrics sin weight_kg ni body_fat_pct devuelve 400", async () => {
  const res = await api("/api/metrics", {
    method: "POST",
    token: memberToken,
    body: { notes: "vacía" },
  });
  assert.equal(res.status, 400);
});

test("POST /api/metrics con valores fuera de rango devuelve 400", async () => {
  const weight = await api("/api/metrics", {
    method: "POST",
    token: memberToken,
    body: { date: daysFromNowIso(-6), weight_kg: 0 },
  });
  assert.equal(weight.status, 400);

  const fat = await api("/api/metrics", {
    method: "POST",
    token: memberToken,
    body: { date: daysFromNowIso(-6), body_fat_pct: 150 },
  });
  assert.equal(fat.status, 400);
});

// --- Edición y borrado -----------------------------------------------------

test("PUT /api/metrics/:id como miembro corrige SU medición (la fecha no cambia)", async () => {
  const date = daysFromNowIso(-3);
  const metric = await createMetric(memberToken, { date, weight_kg: 80.0 });

  const res = await api(`/api/metrics/${metric.id}`, {
    method: "PUT",
    token: memberToken,
    body: { weight_kg: 79.4 },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.weight_kg, 79.4);
  assert.equal(body.date, date, "la fecha identifica la serie y no se toca");
});

test("PUT /api/metrics/:id de otro miembro devuelve 403", async () => {
  const metric = await createMetric(adminToken, { user_id: sofiaId, date: daysFromNowIso(-8), weight_kg: 61 });

  const res = await api(`/api/metrics/${metric.id}`, {
    method: "PUT",
    token: memberToken,
    body: { weight_kg: 55 },
  });
  assert.equal(res.status, 403);
});

test("PUT /api/metrics/:id como entrenador corrige la de un miembro (200)", async () => {
  const metric = await createMetric(adminToken, { user_id: miguelId, date: daysFromNowIso(-4), body_fat_pct: 23.0 });

  const res = await api(`/api/metrics/${metric.id}`, {
    method: "PUT",
    token: carlaToken,
    body: { body_fat_pct: 22.6, notes: "evaluación trimestral" },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.body_fat_pct, 22.6);
  assert.equal(body.notes, "evaluación trimestral");
});

test("PUT /api/metrics/:id sin valores devuelve 400", async () => {
  const metric = await createMetric(adminToken, { user_id: miguelId, date: daysFromNowIso(-12), weight_kg: 78 });
  const res = await api(`/api/metrics/${metric.id}`, { method: "PUT", token: memberToken, body: {} });
  assert.equal(res.status, 400);
});

test("DELETE /api/metrics/:id como recepcion devuelve 403; como admin 204", async () => {
  const metric = await createMetric(adminToken, { user_id: miguelId, date: daysFromNowIso(-7), weight_kg: 83 });

  const forbidden = await api(`/api/metrics/${metric.id}`, { method: "DELETE", token: recepcionToken });
  assert.equal(forbidden.status, 403);

  const res = await api(`/api/metrics/${metric.id}`, { method: "DELETE", token: adminToken });
  assert.equal(res.status, 204);
});

test("GET /api/metrics/:id inexistente devuelve 404", async () => {
  const res = await api("/api/metrics/999999", { token: memberToken });
  assert.equal(res.status, 404);
});
