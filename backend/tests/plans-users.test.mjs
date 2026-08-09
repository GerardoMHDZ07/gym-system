// Tests de contrato para los cambios de contrato de la Fase 8:
//   - GET /api/plans: catálogo de planes de membresía (solo lectura, autenticado).
//     price llega como número (cast float8), no como string.
//   - GET /api/users ahora incluye a entrenador (solo lectura, columnas públicas:
//     sin password_hash). Escritura/borrado siguen admin/recepcion.
//
// Requiere: DB con 002_seed.sql aplicado y backend corriendo en http://127.0.0.1:4000.

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

let memberToken, carlaToken, adminToken;

before(async () => {
  memberToken = (await login("miguel@gym.local", "demo1234")).token;
  carlaToken = (await login("carla@gym.local", "demo1234")).token;
  adminToken = (await login("admin@gym.local", "demo1234")).token;
});

after(async () => {
  await pool.end();
});

test("GET /api/plans sin token devuelve 401", async () => {
  const res = await api("/api/plans");
  assert.equal(res.status, 401);
});

test("GET /api/plans como miembro devuelve el catálogo con price numérico", async () => {
  const res = await api("/api/plans", { token: memberToken });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body) && body.length >= 3, "debería incluir los 3 planes del seed");
  for (const p of body) {
    assert.ok(p.id && p.name && p.duration_days > 0);
    assert.equal(typeof p.price, "number", "price debe venir como número, no string");
  }
  const mensual = body.find((p) => p.name === "Mensual");
  assert.equal(mensual.price, 450);
});

test("GET /api/users como entrenador devuelve 200 con columnas públicas (sin password_hash)", async () => {
  const res = await api("/api/users", { token: carlaToken });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body) && body.length >= 7, "debería incluir los 7 usuarios del seed");
  for (const u of body) {
    assert.equal(u.password_hash, undefined, "nunca se expone password_hash");
    assert.ok(u.id && u.name && u.email && u.role);
  }
});

test("el entrenador NO puede crear usuarios (sigue siendo admin/recepcion)", async () => {
  const res = await api("/api/users", {
    method: "POST",
    token: carlaToken,
    body: { name: "X", email: "x@x.com", password: "12345678", role: "miembro" },
  });
  assert.equal(res.status, 403);
});

test("GET /api/users/:id como admin sigue funcionando", async () => {
  const list = await (await api("/api/users", { token: adminToken })).json();
  const res = await api(`/api/users/${list[0].id}`, { token: adminToken });
  assert.equal(res.status, 200);
});
