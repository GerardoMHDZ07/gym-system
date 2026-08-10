// Verificación de protocolo MCP: habla JSON-RPC real por stdio contra el
// servidor, sin importar cómo esté implementado por dentro. Sirve como
// criterio de aceptación de la Fase 1, no como parte de la solución.
//
// Uso: node verify-protocol.mjs
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const tsxCli = require.resolve("tsx/cli");

const child = spawn(process.execPath, [tsxCli, "src/index.ts"], {
  cwd: new URL(".", import.meta.url).pathname,
  stdio: ["pipe", "pipe", "pipe"],
});

let buffer = "";
const pending = new Map();
let nextId = 1;
let failed = false;

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  let idx;
  while ((idx = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

child.stderr.on("data", (chunk) => {
  process.stderr.write(`[server stderr] ${chunk}`);
});

function send(method, params) {
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

function check(label, condition) {
  if (condition) {
    console.log(`✔ ${label}`);
  } else {
    console.log(`✖ ${label}`);
    failed = true;
  }
}

async function main() {
  const init = await send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "verify-protocol", version: "0.0.1" },
  });
  check("initialize responde con serverInfo.name", !!init.result?.serverInfo?.name);

  notify("notifications/initialized", {});

  const list = await send("tools/list", {});
  const tools = list.result?.tools ?? [];
  check("tools/list incluye health_check", tools.some((t) => t.name === "health_check"));

  const call = await send("tools/call", { name: "health_check", arguments: {} });
  const text = call.result?.content?.[0]?.text ?? "";
  check("tools/call devuelve contenido de texto no vacío", text.length > 0);
  check("tools/call no truena aunque la respuesta no sea JSON válido", call.result?.isError !== true || text.length > 0);

  console.log("\n--- resultado crudo del tools/call, para inspección manual ---");
  console.log(text);

  child.kill();
  process.exit(failed ? 1 : 0);
}

main();
