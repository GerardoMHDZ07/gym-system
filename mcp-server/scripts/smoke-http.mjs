// Smoke test del transporte HTTP (Streamable HTTP) del MCP server, contra el
// backend real (sin mocks). Uso: npm run smoke:http (hace build y corre este
// script). Respeta GYM_API_URL igual que el server (default Render); arranca
// el server HTTP en un puerto efímero (MCP_PORT o 4001).
import { spawn } from "node:child_process";

const PORT = process.env.MCP_PORT || 4001;
const BASE = `http://127.0.0.1:${PORT}`;

const child = spawn("node", ["dist/http.js"], {
  env: { ...process.env, MCP_PORT: String(PORT), MCP_HOST: "127.0.0.1" },
  stdio: ["ignore", "pipe", "inherit"],
});

child.on("error", (err) => {
  console.error(`No se pudo arrancar el server (¿corrió npm run build?): ${err.message}`);
  process.exit(1);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Esperar el health check
for (let i = 0; i < 40; i++) {
  try {
    const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) });
    if (r.ok) break;
  } catch {
    /* server arrancando */
  }
  await sleep(500);
}
try {
  const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) });
  if (!r.ok) throw new Error(`health ${r.status}`);
} catch {
  console.error("HTTP server no levantó (¿corrió npm run build?)");
  child.kill();
  process.exit(1);
}
console.log("HTTP server UP");

const expect = (label, actual, expected) => {
  const ok = actual === expected;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) {
    console.log(`  expected: ${expected}`);
    console.log(`  actual:   ${actual}`);
  }
  return ok;
};
const expectContains = (label, actual, needle) => {
  const ok = typeof actual === "string" && actual.includes(needle);
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) {
    console.log(`  expected to contain: ${needle}`);
    console.log(`  actual: ${String(actual).slice(0, 200)}`);
  }
  return ok;
};

let nextId = 1;
let sessionId = null;
const headers = (extra = {}) => ({
  "Content-Type": "application/json",
  // El spec Streamable HTTP exige que el cliente acepte ambos formatos de respuesta.
  Accept: "application/json, text/event-stream",
  ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
  ...extra,
});

// POST JSON-RPC y espera respuesta (un request por vez).
async function rpc(method, params) {
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  const sid = res.headers.get("mcp-session-id");
  if (sid) sessionId = sid;
  const body = await res.json();
  if (body.error) throw new Error(`JSON-RPC error ${body.error.message}`);
  return body.result;
}

// Notificación: el server responde 202 Accepted sin body.
async function notify(method, params) {
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ jsonrpc: "2.0", method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  return res.status;
}

async function tool(name, args = {}) {
  const result = await rpc("tools/call", { name, arguments: args });
  return result.content?.[0]?.text ?? JSON.stringify(result);
}

let failed = 0;

// --- Handshake y flujo de sesión/login -------------------------------------

const init = await rpc("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "smoke-http", version: "0.0.1" },
});
failed += !expect("initialize devuelve protocolVersion", !!init.protocolVersion, true);
failed += !expect("initialize genera Mcp-Session-Id", typeof sessionId === "string" && sessionId.length > 0, true);
failed += !expect("notifications/initialized → 202", await notify("notifications/initialized"), 202);

// --- Multi-cliente: una segunda sesión convive con la primera ---------------

const init2Res = await fetch(`${BASE}/mcp`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 900,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "smoke-http-2", version: "0.0.1" },
    },
  }),
  signal: AbortSignal.timeout(15_000),
});
const sid2 = init2Res.headers.get("mcp-session-id");
failed += !expect("segundo cliente inicializa OK (multi-cliente)", init2Res.status, 200);
failed += !expect(
  "segunda sesión tiene su propio Mcp-Session-Id",
  typeof sid2 === "string" && sid2 !== sessionId,
  true
);
const del2 = await fetch(`${BASE}/mcp`, {
  method: "DELETE",
  headers: { "Mcp-Session-Id": sid2, Accept: "application/json, text/event-stream" },
  signal: AbortSignal.timeout(5000),
});
failed += !expect("cerrar la segunda sesión (200)", del2.status, 200);

const NO_SESSION = "No hay sesión activa, usa login primero";
failed += !expect("whoami sin sesión", await tool("whoami"), NO_SESSION);
failed += !expect(
  "login admin",
  await tool("login", { email: "admin@gym.local", password: "demo1234" }),
  "Sesión iniciada: Ana Torres — admin@gym.local (rol: admin)"
);
failed += !expect(
  "whoami con sesión (la sesión de login sobrevive en el proceso HTTP)",
  await tool("whoami"),
  "Sesión activa: Ana Torres — admin@gym.local (rol: admin)"
);
const users = await tool("list_users");
failed += !expectContains("list_users devuelve usuarios del seed", users, '"admin@gym.local"');
failed += !expect("logout", await tool("logout"), "Sesión cerrada");
failed += !expect("whoami tras logout", await tool("whoami"), NO_SESSION);

// --- GET SSE: abre el stream de la sesión y recibe el evento de priming -----

const streamRes = await fetch(`${BASE}/mcp`, {
  headers: headers(),
  signal: AbortSignal.timeout(15_000),
});
failed += !expect("GET /mcp abre el stream SSE (200)", streamRes.status, 200);
failed += !expect(
  "GET /mcp devuelve text/event-stream",
  streamRes.headers.get("content-type")?.startsWith("text/event-stream"),
  true
);
// En modo JSON-response el stream SSE queda en silencio hasta que el server
// tenga algo que notificar (nuestros tools no emiten notificaciones): no hay
// priming event que esperar, basta con validar que el stream abre.
streamRes.body.cancel();

// --- DELETE: cierra la sesión ----------------------------------------------

const del = await fetch(`${BASE}/mcp`, { method: "DELETE", headers: headers(), signal: AbortSignal.timeout(5000) });
failed += !expect("DELETE /mcp cierra la sesión (200)", del.status, 200);

const afterDelete = await fetch(`${BASE}/mcp`, { headers: headers(), signal: AbortSignal.timeout(5000) });
failed += !expect("GET con sesión eliminada → 400", afterDelete.status, 400);

// --- CORS -------------------------------------------------------------------

const preflight = (origin) =>
  fetch(`${BASE}/mcp`, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type,mcp-session-id",
    },
    signal: AbortSignal.timeout(5000),
  });

const okCors = await preflight("http://localhost:5173");
failed += !expect(
  "preflight con origen permitido → ACAO del origen",
  okCors.headers.get("access-control-allow-origin"),
  "http://localhost:5173"
);

const badCors = await preflight("https://evil.example");
failed += !expect(
  "preflight con origen NO permitido → sin ACAO",
  badCors.headers.get("access-control-allow-origin"),
  null
);

child.kill();

if (failed > 0) {
  console.error(`\n${failed} aserción(es) fallida(s)`);
  process.exit(1);
}
console.log("\nTransporte HTTP (Streamable HTTP) OK: handshake, tools, SSE, DELETE y CORS");
process.exit(0);
