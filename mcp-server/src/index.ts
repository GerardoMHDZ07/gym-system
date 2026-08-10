import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// URL base del backend. Se sobreescribe con GYM_API_URL (p. ej. para apuntar al
// backend local en dev). Si la env var llega vacía se trata como no seteada
// (misma convención que CORS_ORIGINS en el backend). Se quitan barras finales
// para no romper el path.
const DEFAULT_API_URL = "https://gym-system-2sb4.onrender.com";
const apiUrl = (process.env.GYM_API_URL?.trim() || DEFAULT_API_URL).replace(
  /\/+$/,
  ""
);

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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("MCP server error:", error);
  process.exit(1);
});
