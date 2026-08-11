import { randomUUID } from "node:crypto";
import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./mcp.js";

// Orígenes permitidos para CORS (misma convención que CORS_ORIGINS en el
// backend): el endpoint MCP lo consumen clientes conocidos. Se sobreescribe con
// MCP_CORS_ORIGINS (coma-separado). Peticiones sin header Origin (curl,
// server-to-server) se permiten siempre.
const MCP_CORS_ORIGINS = (
  process.env.MCP_CORS_ORIGINS?.trim() ||
  [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8080",
  ].join(",")
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Por defecto solo localhost (con protección DNS rebinding del helper del SDK);
// para exponerlo, setear MCP_HOST/MCP_PORT (p. ej. 0.0.0.0:4001).
const HOST = process.env.MCP_HOST || "127.0.0.1";
const PORT = Number(process.env.MCP_PORT || 4001);

// Capa 1 — API key compartida, ANTES de cualquier lógica de sesión MCP: el
// header X-MCP-API-Key debe coincidir con MCP_API_KEY. Si la variable no está
// configurada, el server queda en fail-closed (/mcp responde 503) para que
// olvidarse de setearla en el deploy nunca deje el endpoint abierto. /health
// queda sin proteger (solo es un check de disponibilidad, no expone datos).
// El transporte stdio (src/index.ts, Claude Desktop local) NO pasa por acá.
const requireApiKey: RequestHandler = (req, res, next) => {
  const expected = process.env.MCP_API_KEY;
  if (!expected) {
    res.status(503).json({ error: "MCP_API_KEY no configurada en el servidor" });
    return;
  }
  if (req.get("x-mcp-api-key") !== expected) {
    res.status(401).json({ error: "API key inválida o ausente (header X-MCP-API-Key)" });
    return;
  }
  next();
};

// Capa 2 — rate limit por IP sobre POST /mcp (30/min): acota los intentos de
// login por minuto sin frenar una sesión MCP legítima (tool calls secuenciales,
// muy por debajo de 30/min). Los 401 de la API key corren antes y no consumen
// cuota; el 429 corta sin tocar la lógica de transporte.
const mcpRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) =>
    res.status(429).json({ error: "Demasiadas peticiones: 30 POSTs/min por IP en /mcp" }),
});

const app: Express = createMcpExpressApp({ host: HOST });
// Detrás del proxy de Render, req.ip sin trust proxy sería la IP del proxy y
// todos los clientes compartirían un solo bucket de rate limit: una sola
// esperanza de proxy (el LB de Render) → req.ip = IP real del cliente (XFF).
app.set("trust proxy", 1);
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || MCP_CORS_ORIGINS.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
  })
);

// Health check para orquestación/smoke test, como el del backend.
app.get("/health", (_req, res) => res.json({ ok: true }));

// Cada sesión HTTP (Mcp-Session-Id) tiene su propio McpServer: el Server del
// SDK v1.30 solo admite UNA conexión a la vez ("Already connected to a
// transport"), así que el multi-cliente requiere una instancia por conexión.
// De paso, cada cliente HTTP tiene su propio estado de login en memoria.
// API key compartida antes de las rutas /mcp (POST/GET/DELETE). El preflight
// OPTIONS lo corta el middleware de cors sin llegar acá.
app.use("/mcp", requireApiKey);

const transports = new Map<string, StreamableHTTPServerTransport>();

// Un cliente que muere sin DELETE (crash, pierde el Mcp-Session-Id) deja su
// sesión colgada: un sweep periódico la cierra y la libera. El timeout es
// generoso porque la sesión MCP es lo que mantiene vivo el login en memoria.
const IDLE_SESSION_MS = 30 * 60 * 1000;
const lastUsed = new Map<string, number>();
const touch = (sid: string) => lastUsed.set(sid, Date.now());

setInterval(() => {
  const now = Date.now();
  for (const [sid, transport] of transports) {
    if (now - (lastUsed.get(sid) ?? 0) > IDLE_SESSION_MS) {
      void transport.close();
      transports.delete(sid);
      lastUsed.delete(sid);
    }
  }
}, 60_000).unref();

async function handleMcpRequest(req: Request, res: Response) {
  const header = req.headers["mcp-session-id"];
  const sessionId = typeof header === "string" ? header : undefined;
  let transport = sessionId ? transports.get(sessionId) : undefined;

  if (!transport) {
    const mcpServer = createMcpServer();
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      // Todos nuestros tools son request/response (sin notificaciones del
      // server): respondemos JSON directo en vez de abrir un stream SSE por POST.
      enableJsonResponse: true,
      // El SDK genera el session id durante el initialize (no en el constructor):
      // este hook es el mecanismo oficial para registrar la sesión en el Map.
      onsessioninitialized: (sid) => {
        transports.set(sid, transport as StreamableHTTPServerTransport);
        touch(sid);
      },
    });
    transport.onclose = () => {
      if (transport?.sessionId) {
        transports.delete(transport.sessionId);
        lastUsed.delete(transport.sessionId);
      }
      void mcpServer.close();
    };
    await mcpServer.connect(transport);
  }

  if (sessionId) touch(sessionId);
  // El body ya viene parsed por express.json() (middleware de createMcpExpressApp).
  await transport.handleRequest(req, res, req.body);
}

app.post("/mcp", mcpRateLimit, handleMcpRequest);

// El GET abre el stream SSE de una sesión ya inicializada: sin sesión no hay
// stream que servir.
app.get("/mcp", async (req, res) => {
  const header = req.headers["mcp-session-id"];
  const sessionId = typeof header === "string" ? header : undefined;
  const transport = sessionId ? transports.get(sessionId) : undefined;
  if (!transport) {
    res.status(400).json({ error: "No session found" });
    return;
  }
  await transport.handleRequest(req, res);
});

app.delete("/mcp", async (req, res) => {
  const header = req.headers["mcp-session-id"];
  const sessionId = typeof header === "string" ? header : undefined;
  const transport = sessionId ? transports.get(sessionId) : undefined;
  if (!transport) {
    res.status(400).json({ error: "No session found" });
    return;
  }
  await transport.handleRequest(req, res);
  transports.delete(sessionId as string);
});

// Errores en JSON, no en la página HTML default de Express (misma convención
// que el middleware de errores del backend).
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof SyntaxError) {
    return res.status(400).json({ error: "JSON inválido" });
  }
  console.error(err);
  res.status(500).json({ error: "Error interno" });
});

if (!process.env.MCP_API_KEY) {
  console.warn(
    "MCP_API_KEY no configurada: /mcp responderá 503 (fail-closed) — requerida para exponer el transporte HTTP"
  );
}

app.listen(PORT, HOST, () =>
  console.log(`MCP server (HTTP) escuchando en http://${HOST}:${PORT}/mcp`)
);
