// Tests de contrato para la Fase 7 (dashboard de reportes / analytics).
// Decisiones del grill-me de esta fase:
//   - Bundle único: GET /api/dashboard/summary con todos los KPIs embebidos.
//   - Solo admin/recepcion (incluye ingresos, dato financiero sensible).
//   - Ventanas fijas: hoy, últimos 7 y 30 días (sin params).
//   - Solo lectura: el dashboard calcula el estado derivado (membresías
//     vigentes, vencidas) sobre la marcha, sin mutar la DB.
//   - Todos los counts/totales se serializan como números (::int / ::float8).
//
// Requiere: DB con 002_seed.sql aplicado y backend corriendo en http://127.0.0.1:4000.
// Nota: los archivos de test corren en paralelo, y este bundle es global; por
// eso las aserciones usan cotas inferiores derivadas del seed + datos propios
// (que nadie más borra) e invariantes internas, no valores exactos.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:4000";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function login(email, password) {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return res.json();
}

async function api(path, { method = "GET", token } = {}) {
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const res = await fetch(`${BASE_URL}${path}`, { method, headers });
  return res;
}

let adminToken, recepcionToken, memberToken, carlaToken;
let createdUserId = null;

before(async () => {
  adminToken = (await login("admin@gym.local", "demo1234")).token;
  recepcionToken = (await login("recepcion@gym.local", "demo1234")).token;
  memberToken = (await login("miguel@gym.local", "demo1234")).token;
  carlaToken = (await login("carla@gym.local", "demo1234")).token;

  // Datos propios: miembro + membresía activa + check-in hoy + pago de 450.
  // Creados en el before para que el dashboard los vea durante toda la corrida.
  const userRes = await pool.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, 'x', 'miembro') RETURNING id`,
    [`Dashboard Test ${Date.now()}`, `dashboard.test.${Date.now()}@gym.local`]
  );
  createdUserId = userRes.rows[0].id;

  const plan = await pool.query(`SELECT id FROM membership_plans WHERE name = 'Mensual' LIMIT 1`);
  assert.equal(plan.rows.length, 1, "el plan 'Mensual' del seed debe existir");
  await pool.query(
    `INSERT INTO memberships (user_id, plan_id, start_date, end_date, status)
     VALUES ($1, $2, CURRENT_DATE, CURRENT_DATE + 30::int, 'activa')`,
    [createdUserId, plan.rows[0].id]
  );

  const membership = await pool.query(
    `SELECT id FROM memberships WHERE user_id = $1 LIMIT 1`,
    [createdUserId]
  );
  await pool.query(
    `INSERT INTO payments (membership_id, amount, method, status)
     VALUES ($1, 450, 'transferencia', 'completado')`,
    [membership.rows[0].id]
  );

  await pool.query(`INSERT INTO checkins (user_id) VALUES ($1)`, [createdUserId]);
});

after(async () => {
  if (createdUserId !== null) {
    // CASCADE limpia membresía, pago y check-in del usuario creado
    await pool.query(`DELETE FROM users WHERE id = $1`, [createdUserId]);
  }
  await pool.end();
});

// --- Acceso ----------------------------------------------------------------

test("GET /api/dashboard/summary sin token devuelve 401", async () => {
  const res = await api("/api/dashboard/summary");
  assert.equal(res.status, 401);
});

test("GET /api/dashboard/summary como miembro devuelve 403", async () => {
  const res = await api("/api/dashboard/summary", { token: memberToken });
  assert.equal(res.status, 403);
});

test("GET /api/dashboard/summary como entrenador devuelve 403 (no ve ingresos)", async () => {
  const res = await api("/api/dashboard/summary", { token: carlaToken });
  assert.equal(res.status, 403);
});

// --- Forma del contrato ----------------------------------------------------

test("GET /api/dashboard/summary como recepcion devuelve el bundle completo (200)", async () => {
  const res = await api("/api/dashboard/summary", { token: recepcionToken });
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.ok(body.members && typeof body.members.total === "number");
  assert.ok(typeof body.members.new_last_30d === "number");

  assert.ok(body.memberships && typeof body.memberships.active === "number");
  assert.ok(Array.isArray(body.memberships.breakdown) && body.memberships.breakdown.length === 3);
  const statuses = body.memberships.breakdown.map((b) => b.status).sort();
  assert.deepEqual(statuses, ["activa", "cancelada", "vencida"]);

  assert.ok(typeof body.checkins.today === "number");
  assert.ok(typeof body.checkins.last_7d_total === "number");
  assert.ok(Array.isArray(body.checkins.by_day_last_7d));
  assert.equal(body.checkins.by_day_last_7d.length, 7, "serie completa de 7 días");

  assert.ok(typeof body.revenue.today === "number");
  assert.ok(typeof body.revenue.last_30d === "number");
  assert.ok(Array.isArray(body.revenue.by_method_last_30d));

  assert.ok(typeof body.classes.upcoming_7d === "number");
  assert.ok(typeof body.classes.active_bookings === "number");
  assert.ok(typeof body.classes.avg_occupancy_7d === "number");
});

// --- Consistencia interna y reflejo de datos ---------------------------------

test("los totales del bundle son consistentes entre sí (invariantes)", async () => {
  const res = await api("/api/dashboard/summary", { token: adminToken });
  assert.equal(res.status, 200);
  const body = await res.json();

  // La suma de la serie diaria es exactamente el total de 7 días
  const sumByDay = body.checkins.by_day_last_7d.reduce((acc, d) => acc + d.count, 0);
  assert.equal(sumByDay, body.checkins.last_7d_total);

  // Cada día de la serie es un 'YYYY-MM-DD' válido y el count es número
  for (const d of body.checkins.by_day_last_7d) {
    assert.match(d.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(typeof d.count, "number");
  }

  // Los ingresos por método suman el total de 30 días (tolerancia de redondeo)
  const sumByMethod = body.revenue.by_method_last_30d.reduce((acc, m) => acc + m.total, 0);
  assert.ok(Math.abs(sumByMethod - body.revenue.last_30d) < 0.05, "by_method ≈ last_30d");
  for (const m of body.revenue.by_method_last_30d) {
    assert.ok(typeof m.total === "number" && m.total >= 0);
  }

  // Ocupación promedio es una proporción válida
  assert.ok(body.classes.avg_occupancy_7d >= 0 && body.classes.avg_occupancy_7d <= 1);
});

test("el dashboard refleja los datos del seed y los propios (cotas inferiores)", async () => {
  const res = await api("/api/dashboard/summary", { token: adminToken });
  assert.equal(res.status, 200);
  const body = await res.json();

  // Seed (3 miembros) + el creado en el before
  assert.ok(body.members.total >= 4, "miembros totales");
  // Seed (miguel y sofia activas) + la creada en el before
  assert.ok(body.memberships.active >= 3, "membresías vigentes");
  const activa = body.memberships.breakdown.find((b) => b.status === "activa");
  assert.ok(activa.count >= 3);
  // Mi check-in de hoy (el de otros archivos puede sumar, nunca restar el mío)
  assert.ok(body.checkins.today >= 1, "check-ins de hoy");
  assert.ok(body.checkins.last_7d_total >= 8, "la serie de 7 días cubre los 8 check-ins del seed");
  // Mi pago de 450 (transferencia) está dentro de los 30 días
  assert.ok(body.revenue.last_30d >= 450, "ingresos 30d");
  const transfer = body.revenue.by_method_last_30d.find((m) => m.method === "transferencia");
  assert.ok(transfer && transfer.total >= 450, "el pago propio aparece por método");
});
