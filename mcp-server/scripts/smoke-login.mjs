// Smoke test del flujo login → whoami → logout → whoami + list_users del MCP
// server, contra el backend real (sin mocks). Uso: npm run smoke:login (hace
// build y corre este script). Respeta GYM_API_URL igual que el server (default
// Render).
//
// El driver es un cliente JSON-RPC SECUENCIAL: envía un mensaje, espera su
// respuesta, y recién entonces envía el siguiente. No se puede pipear todo el
// input de golpe: el SDK procesa requests concurrentemente y un whoami podría
// ejecutarse mientras el login anterior sigue en vuelo (falso negativo).
import { spawn } from "node:child_process";

const child = spawn("node", ["dist/index.js"], { stdio: ["pipe", "pipe", "inherit"] });

child.on("error", (err) => {
  console.error(`No se pudo arrancar el server (¿corrió npm run build?): ${err.message}`);
  process.exit(1);
});

let buffer = "";
let queue = [];
child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  let idx;
  while ((idx = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    const waiter = queue.shift();
    if (!waiter) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      // Línea no-JSON en stdout: resolver como error en vez de colgar.
      waiter({ error: { message: `stdout no-JSON: ${line.slice(0, 80)}` } });
      continue;
    }
    waiter(msg);
  }
});

// Si el server muere a mitad del flujo (crash, dist inexistente), resolver los
// waiters pendientes con un error para que el script falle limpio y no cuelgue.
child.on("exit", (code, signal) => {
  const waiters = queue.splice(0);
  for (const waiter of waiters) {
    waiter({ error: { message: `server salió antes de responder (code ${code}, signal ${signal})` } });
  }
});

const send = (obj) =>
  new Promise((resolve) => {
    queue.push(resolve);
    child.stdin.write(JSON.stringify(obj) + "\n");
  });

const callTool = async (name, args = {}) => {
  const msg = await send({
    jsonrpc: "2.0",
    id: Math.floor(Math.random() * 1e6),
    method: "tools/call",
    params: { name, arguments: args },
  });
  const text = msg.result?.content?.[0]?.text ?? JSON.stringify(msg.error ?? msg);
  console.log(`  ${name}: ${text}`);
  return text;
};

// Los nombres/emails esperados son los del seed (002_seed.sql).
const expect = (label, actual, expected) => {
  const ok = actual === expected;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) {
    console.log(`  expected: ${expected}`);
    console.log(`  actual:   ${actual}`);
  }
  return ok;
};

// Para respuestas que dependen de la DB (list_users devuelve el JSON de todos
// los usuarios; si el seed creciera no debe romper el smoke test).
const expectContains = (label, actual, needle) => {
  const ok = typeof actual === "string" && actual.includes(needle);
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) {
    console.log(`  expected to contain: ${needle}`);
    console.log(`  actual: ${String(actual).slice(0, 200)}`);
  }
  return ok;
};

// Handshake
await send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke-login", version: "0.0.1" },
  },
});
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
await new Promise((r) => setTimeout(r, 100));

const NO_SESSION = "No hay sesión activa, usa login primero";
let failed = 0;

failed += !expect("whoami sin sesión", await callTool("whoami"), NO_SESSION);
failed += !expect(
  "login con credenciales malas → 401",
  await callTool("login", { email: "nobody@gym.local", password: "wrong" }),
  "error: credenciales inválidas (401)"
);
failed += !expect("whoami sigue sin sesión (el 401 no sobreescribe)", await callTool("whoami"), NO_SESSION);
failed += !expect(
  "login admin",
  await callTool("login", { email: "admin@gym.local", password: "demo1234" }),
  "Sesión iniciada: Ana Torres — admin@gym.local (rol: admin)"
);
failed += !expect(
  "whoami con sesión admin",
  await callTool("whoami"),
  "Sesión activa: Ana Torres — admin@gym.local (rol: admin)"
);
const usersAdmin = await callTool("list_users");
failed += !expectContains("list_users con sesión admin devuelve JSON con usuarios", usersAdmin, '"admin@gym.local"');
failed += !expectContains("list_users incluye a los miembros del seed", usersAdmin, '"miguel@gym.local"');
failed += !expect(
  "login miguel sobreescribe la sesión en silencio",
  await callTool("login", { email: "miguel@gym.local", password: "demo1234" }),
  "Sesión iniciada: Miguel Hernandez — miguel@gym.local (rol: miembro)"
);
failed += !expect(
  "whoami con sesión miguel",
  await callTool("whoami"),
  "Sesión activa: Miguel Hernandez — miguel@gym.local (rol: miembro)"
);
failed += !expect(
  "list_users con rol miembro → 403 sin permisos",
  await callTool("list_users"),
  "error: sin permisos (403): tu rol no puede listar usuarios"
);
failed += !expect(
  "whoami tras el 403 (la sesión NO se limpió)",
  await callTool("whoami"),
  "Sesión activa: Miguel Hernandez — miguel@gym.local (rol: miembro)"
);
failed += !expect("logout", await callTool("logout"), "Sesión cerrada");
failed += !expect("whoami tras logout", await callTool("whoami"), NO_SESSION);
failed += !expect(
  "list_users sin sesión → pedir login",
  await callTool("list_users"),
  NO_SESSION
);

child.kill();

if (failed > 0) {
  console.error(`\n${failed} aserción(es) fallida(s)`);
  process.exit(1);
}
console.log("\nFlujo login → whoami → logout → whoami + list_users OK contra el backend real");
process.exit(0);
