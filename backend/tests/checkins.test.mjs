// Tests de contrato para la Fase 2 (check-in y control de acceso).
// No le importa CÓMO está implementado, solo que la API se comporte así,
// según las decisiones cerradas en el grill-me de esta fase.
//
// Requiere: la DB con 002_seed.sql aplicado, y el backend corriendo.
// Uso: node --test tests/checkins.test.mjs

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:4000";
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function login(email, password) {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return res.json();
}

// Crea un miembro nuevo con membresía activa directamente en la DB,
// para no depender ni contaminar los datos del seed entre corridas.
async function createActiveMember() {
  const email = `checkin.test.${Date.now()}.${Math.random()
    .toString(36)
    .slice(2)}@gym.local`;
  const userRes = await pool.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, 'x', 'miembro') RETURNING id`,
    ["Checkin Test", email]
  );
  const userId = userRes.rows[0].id;
  const planRes = await pool.query(
    `SELECT id FROM membership_plans WHERE name = 'Mensual' LIMIT 1`
  );
  await pool.query(
    `INSERT INTO memberships (user_id, plan_id, start_date, end_date, status)
     VALUES ($1, $2, CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', 'activa')`,
    [userId, planRes.rows[0].id]
  );
  return email;
}

let adminToken, recepcionToken, memberToken;

before(async () => {
  adminToken = (await login("admin@gym.local", "demo1234")).token;
  recepcionToken = (await login("recepcion@gym.local", "demo1234")).token;
  memberToken = (await login("miguel@gym.local", "demo1234")).token;
});

after(async () => {
  await pool.end();
});

test("POST /api/checkins sin token devuelve 401", async () => {
  const res = await fetch(`${BASE_URL}/api/checkins`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "miguel@gym.local" }),
  });
  assert.equal(res.status, 401);
});

test("POST /api/checkins con token de miembro devuelve 403 (self-check-in no permitido)", async () => {
  const res = await fetch(`${BASE_URL}/api/checkins`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${memberToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email: "miguel@gym.local" }),
  });
  assert.equal(res.status, 403);
});

test("POST /api/checkins para miembro con membresía vencida devuelve 403", async () => {
  const res = await fetch(`${BASE_URL}/api/checkins`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${recepcionToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email: "daniel@gym.local" }),
  });
  assert.equal(res.status, 403);
});

test("POST /api/checkins con email que no existe devuelve 404", async () => {
  const res = await fetch(`${BASE_URL}/api/checkins`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${recepcionToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email: "no-existe@gym.local" }),
  });
  assert.equal(res.status, 404);
});

test("POST /api/checkins como recepcion, para miembro con membresía activa, registra el check-in (201)", async () => {
  const email = await createActiveMember();
  const res = await fetch(`${BASE_URL}/api/checkins`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${recepcionToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email }),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.ok(body.id);
  assert.ok(body.checkin_time);
});

test("un miembro puede tener máximo 2 check-ins por día; el 3ro devuelve 409", async () => {
  const email = await createActiveMember();

  for (let i = 0; i < 2; i++) {
    const res = await fetch(`${BASE_URL}/api/checkins`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${recepcionToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email }),
    });
    assert.equal(res.status, 201, `check-in #${i + 1} debería ser exitoso`);
  }

  const thirdRes = await fetch(`${BASE_URL}/api/checkins`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${recepcionToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email }),
  });
  assert.equal(thirdRes.status, 409);
});

test("GET /api/checkins sin token devuelve 401", async () => {
  const res = await fetch(`${BASE_URL}/api/checkins`);
  assert.equal(res.status, 401);
});

test("GET /api/checkins con token de miembro devuelve 403", async () => {
  const res = await fetch(`${BASE_URL}/api/checkins`, {
    headers: { Authorization: `Bearer ${memberToken}` },
  });
  assert.equal(res.status, 403);
});

test("GET /api/checkins con token de admin devuelve 200 y una lista", async () => {
  const res = await fetch(`${BASE_URL}/api/checkins`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body));
});

test("PUT /api/checkins/:id no existe como operación (los check-ins son inmutables)", async () => {
  const res = await fetch(`${BASE_URL}/api/checkins/1`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ checkin_time: new Date().toISOString() }),
  });
  assert.equal(res.status, 404);
});

test("DELETE /api/checkins/:id con token de recepcion devuelve 403 (solo admin puede borrar)", async () => {
  const res = await fetch(`${BASE_URL}/api/checkins/1`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${recepcionToken}` },
  });
  assert.equal(res.status, 403);
});

test("DELETE /api/checkins/:id con token de admin borra un check-in existente (204)", async () => {
  const email = await createActiveMember();
  const createRes = await fetch(`${BASE_URL}/api/checkins`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${recepcionToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email }),
  });
  const created = await createRes.json();

  const deleteRes = await fetch(`${BASE_URL}/api/checkins/${created.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(deleteRes.status, 204);
});
