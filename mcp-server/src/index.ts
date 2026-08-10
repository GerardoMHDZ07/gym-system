import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// URL base del backend. Se sobreescribe con GYM_API_URL (p. ej. para apuntar al
// backend local en dev). Si la env var llega vacía se trata como no seteada
// (misma convención que CORS_ORIGINS en el backend). Se quitan barras finales
// para no romper el path.
const DEFAULT_API_URL = "https://gym-system-2sb4.onrender.com";
const apiUrl = (process.env.GYM_API_URL?.trim() || DEFAULT_API_URL).replace(
  /\/+$/,
  ""
);

// Sesión en memoria del proceso — nunca en disco. Un solo slot: login
// sobreescribe la sesión anterior solo si las credenciales son válidas; un
// login fallido (401) deja la sesión existente intacta.
interface Session {
  token: string;
  user: { id: number; name: string; email: string; role: string };
}
let session: Session | null = null;

// Mensaje compartido por whoami y list_users (y por el smoke test): si se
// cambia acá, hay que cambiarlo también en scripts/smoke-login.mjs.
const NO_SESSION_MSG = "No hay sesión activa, usa login primero";

const server = new McpServer({
  name: "gym-system-mcp",
  version: "0.1.0",
});

server.tool(
  "health_check",
  "Gets the gym backend /health endpoint and returns the HTTP status and response body",
  {},
  async () => {
    try {
      const res = await fetch(`${apiUrl}/health`, {
        signal: AbortSignal.timeout(10_000),
      });
      const raw = await res.text();

      // Pretty-print when the body is JSON; otherwise keep the raw text so an
      // HTML/plain error page never crashes the tool.
      let body: string;
      try {
        body = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        body = raw || "(empty body)";
      }

      return {
        content: [{ type: "text", text: `status: ${res.status}\nbody: ${body}` }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  }
);

server.tool(
  "login",
  "Logs in against the gym backend and stores the session (token + user) in memory. Returns the logged-in user's name, email and role — never the raw token.",
  { email: z.string().email(), password: z.string().min(1) },
  async ({ email, password }) => {
    try {
      const res = await fetch(`${apiUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        signal: AbortSignal.timeout(10_000),
      });
      const raw = await res.text();

      let data: { token?: string; user?: Session["user"]; error?: string };
      try {
        data = JSON.parse(raw);
      } catch {
        return {
          content: [
            {
              type: "text",
              text: `error: respuesta no-JSON del backend (status ${res.status}): ${raw || "(empty body)"}`,
            },
          ],
        };
      }

      if (!res.ok) {
        return {
          content: [
            {
              type: "text",
              text:
                res.status === 401
                  ? "error: credenciales inválidas (401)"
                  : `error: el backend respondió ${res.status}: ${data.error ?? raw}`,
            },
          ],
        };
      }

      if (!data.token || !data.user) {
        return {
          content: [
            {
              type: "text",
              text: "error: la respuesta del backend no incluye token ni user",
            },
          ],
        };
      }

      session = { token: data.token, user: data.user };
      return {
        content: [
          {
            type: "text",
            text: `Sesión iniciada: ${data.user.name} — ${data.user.email} (rol: ${data.user.role})`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  }
);

server.tool(
  "whoami",
  "Returns the currently logged-in user (name, email, role) or an explicit message when there is no active session",
  {},
  async () => {
    if (!session) {
      return { content: [{ type: "text", text: NO_SESSION_MSG }] };
    }
    const { user } = session;
    return {
      content: [
        {
          type: "text",
          text: `Sesión activa: ${user.name} — ${user.email} (rol: ${user.role})`,
        },
      ],
    };
  }
);

server.tool(
  "logout",
  "Clears the in-memory session, if any",
  {},
  async () => {
    if (!session) {
      return { content: [{ type: "text", text: "No había sesión activa" }] };
    }
    session = null;
    return { content: [{ type: "text", text: "Sesión cerrada" }] };
  }
);

server.tool(
  "list_users",
  "Lists gym users (id, name, email, role, created_at) from the protected GET /api/users endpoint using the logged-in session. Requires an active session with role admin, recepcion or entrenador.",
  {},
  async () => {
    if (!session) {
      return { content: [{ type: "text", text: NO_SESSION_MSG }] };
    }
    try {
      const res = await fetch(`${apiUrl}/api/users`, {
        headers: { Authorization: `Bearer ${session.token}` },
        signal: AbortSignal.timeout(10_000),
      });
      const raw = await res.text();

      if (res.status === 401) {
        // Token muerto (venció o dejó de ser válido): la sesión guardada ya no
        // sirve, se limpia para que whoami no mienta (decisión del grill-me Fase 2).
        session = null;
        return {
          content: [
            {
              type: "text",
              text: "Sesión vencida o inválida (401): se cerró la sesión, usa login primero",
            },
          ],
        };
      }

      if (res.status === 403) {
        // Token válido pero rol insuficiente: la sesión sigue sirviendo, no se toca.
        return {
          content: [
            {
              type: "text",
              text: "error: sin permisos (403): tu rol no puede listar usuarios",
            },
          ],
        };
      }

      let body: string;
      try {
        body = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        body = raw || "(empty body)";
      }

      if (!res.ok) {
        return {
          content: [
            { type: "text", text: `error: el backend respondió ${res.status}: ${body}` },
          ],
        };
      }

      return { content: [{ type: "text", text: body }] };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("MCP server error:", error);
  process.exit(1);
});
