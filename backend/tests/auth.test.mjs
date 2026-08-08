// Tests de contrato para la Fase 1 (auth + CRUD de usuarios).
// No le importa CÓMO está implementado, solo que la API se comporte así.
// Requiere: la DB con 002_seed.sql aplicado, y el backend corriendo.
//
// Uso:
//   node --test tests/

import { test } from "node:test";
import assert from "node:assert/strict";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:4000";

async function login(email, password) {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return { status: res.status, body: await res.json() };
}

test("login con credenciales correctas devuelve token y nunca expone password_hash", async () => {
  const { status, body } = await login("admin@gym.local", "demo1234");
  assert.equal(status, 200);
  assert.ok(body.token, "debe incluir un token");
  assert.equal(body.user.email, "admin@gym.local");
  assert.equal(body.password_hash, undefined);
  assert.equal(body.user.password_hash, undefined);
});

test("login con password incorrecto devuelve 401", async () => {
  const { status, body } = await login("admin@gym.local", "password-mala");
  assert.equal(status, 401);
  assert.ok(body.error);
});

test("login con email inexistente devuelve el mismo 401 (no debe filtrar qué emails existen)", async () => {
  const { status } = await login("no-existe@gym.local", "demo1234");
  assert.equal(status, 401);
});

test("GET /api/users sin token devuelve 401", async () => {
  const res = await fetch(`${BASE_URL}/api/users`);
  assert.equal(res.status, 401);
});

test("GET /api/users con token de admin devuelve 200 y ningún usuario expone password_hash", async () => {
  const { body: loginBody } = await login("admin@gym.local", "demo1234");
  const res = await fetch(`${BASE_URL}/api/users`, {
    headers: { Authorization: `Bearer ${loginBody.token}` },
  });
  assert.equal(res.status, 200);
  const users = await res.json();
  assert.ok(Array.isArray(users) && users.length > 0);
  for (const u of users) assert.equal(u.password_hash, undefined);
});

test("GET /api/users con token de un miembro devuelve 403 (rol insuficiente)", async () => {
  const { body: loginBody } = await login("miguel@gym.local", "demo1234");
  const res = await fetch(`${BASE_URL}/api/users`, {
    headers: { Authorization: `Bearer ${loginBody.token}` },
  });
  assert.equal(res.status, 403);
});

test("POST /api/users como admin crea un usuario nuevo (201) y no expone password_hash", async () => {
  const { body: loginBody } = await login("admin@gym.local", "demo1234");
  const uniqueEmail = `test.${Date.now()}@gym.local`;
  const res = await fetch(`${BASE_URL}/api/users`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${loginBody.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "Usuario de prueba",
      email: uniqueEmail,
      password: "demo1234",
      role: "entrenador",
    }),
  });
  assert.equal(res.status, 201);
  const created = await res.json();
  assert.equal(created.email, uniqueEmail);
  assert.equal(created.password_hash, undefined);
});

test("POST /api/users con email ya existente devuelve 409", async () => {
  const { body: loginBody } = await login("admin@gym.local", "demo1234");
  const res = await fetch(`${BASE_URL}/api/users`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${loginBody.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "Duplicado",
      email: "admin@gym.local",
      password: "demo1234",
      role: "miembro",
    }),
  });
  assert.equal(res.status, 409);
});

test("POST /api/users con password menor a 8 caracteres devuelve 400", async () => {
  const { body: loginBody } = await login("admin@gym.local", "demo1234");
  const res = await fetch(`${BASE_URL}/api/users`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${loginBody.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "Corto",
      email: `corto.${Date.now()}@gym.local`,
      password: "123",
      role: "miembro",
    }),
  });
  assert.equal(res.status, 400);
});

test("DELETE /api/users/:id con token de recepcion devuelve 403 (solo admin puede borrar)", async () => {
  const { body: loginBody } = await login("recepcion@gym.local", "demo1234");
  const res = await fetch(`${BASE_URL}/api/users/999`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${loginBody.token}` },
  });
  assert.equal(res.status, 403);
});

test("GET /api/users/:id con token de admin devuelve 200 y no expone password_hash", async () => {
  const { body: loginBody } = await login("admin@gym.local", "demo1234");
  const res = await fetch(`${BASE_URL}/api/users/1`, {
    headers: { Authorization: `Bearer ${loginBody.token}` },
  });
  assert.equal(res.status, 200);
  const user = await res.json();
  assert.equal(user.password_hash, undefined);
});

test("PUT /api/users/:id como admin actualiza role y password y el nuevo password loguea", async () => {
  const { body: loginBody } = await login("admin@gym.local", "demo1234");
  const uniqueEmail = `put.${Date.now()}@gym.local`;
  const createRes = await fetch(`${BASE_URL}/api/users`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${loginBody.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: "Para editar", email: uniqueEmail, password: "demo1234", role: "miembro" }),
  });
  assert.equal(createRes.status, 201);
  const created = await createRes.json();

  const updateRes = await fetch(`${BASE_URL}/api/users/${created.id}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${loginBody.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ role: "entrenador", password: "nuevo1234" }),
  });
  assert.equal(updateRes.status, 200);
  const updated = await updateRes.json();
  assert.equal(updated.role, "entrenador");
  assert.equal(updated.password_hash, undefined);

  const relogin = await login(uniqueEmail, "nuevo1234");
  assert.equal(relogin.status, 200);

  await fetch(`${BASE_URL}/api/users/${created.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${loginBody.token}` },
  });
});

test("PUT /api/users/:id como recepcion no puede cambiar el role (403)", async () => {
  const { body: loginBody } = await login("recepcion@gym.local", "demo1234");
  const res = await fetch(`${BASE_URL}/api/users/1`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${loginBody.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ role: "miembro" }),
  });
  assert.equal(res.status, 403);
});

test("PUT /api/users/:id como recepcion no puede cambiar el password (403)", async () => {
  const { body: loginBody } = await login("recepcion@gym.local", "demo1234");
  const res = await fetch(`${BASE_URL}/api/users/1`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${loginBody.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password: "otra1234" }),
  });
  assert.equal(res.status, 403);
});

test("POST /api/users como recepcion no puede crear admins (403)", async () => {
  const { body: loginBody } = await login("recepcion@gym.local", "demo1234");
  const res = await fetch(`${BASE_URL}/api/users`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${loginBody.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "No admin",
      email: `noadmin.${Date.now()}@gym.local`,
      password: "demo1234",
      role: "admin",
    }),
  });
  assert.equal(res.status, 403);
});

test("POST /api/users como recepcion puede crear un miembro (201)", async () => {
  const { body: loginBody } = await login("recepcion@gym.local", "demo1234");
  const res = await fetch(`${BASE_URL}/api/users`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${loginBody.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "Creado por recepcion",
      email: `rec.${Date.now()}@gym.local`,
      password: "demo1234",
      role: "miembro",
    }),
  });
  assert.equal(res.status, 201);
  const created = await res.json();
  assert.equal(created.password_hash, undefined);
});

test("login con email malformado devuelve 400 (validación zod)", async () => {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "no-es-mail", password: "demo1234" }),
  });
  assert.equal(res.status, 400);
});
