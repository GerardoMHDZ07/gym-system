# gym-system MCP server

Servidor [MCP](https://modelcontextprotocol.io) que expone los datos y acciones de
**gym-system** a clientes de IA como Claude Desktop, vía el protocolo MCP.

## Tools

| Tool | Inputs | Qué hace |
|---|---|---|
| `health_check` | — | Consulta `GET /health` del backend y devuelve el status HTTP + el body (tolera body no-JSON). No requiere sesión. |
| `login` | `email`, `password` | Inicia sesión contra el backend (`POST /api/auth/login`) y guarda la sesión en memoria del proceso. Devuelve nombre/email/rol, nunca el token. |
| `whoami` | — | Devuelve el usuario logueado (nombre/email/rol), o un mensaje claro si no hay sesión activa. No toca el backend. |
| `logout` | — | Cierra la sesión en memoria. |
| `list_users` | — | Lista los usuarios del gym (`id, name, email, role, created_at`) desde `GET /api/users` con el token de la sesión. **Requiere sesión activa con rol `admin`, `recepcion` o `entrenador`** (miembro → 403; un 401 del backend cierra la sesión). |

## Correrlo en local (stdio, para Claude Desktop)

```bash
cd mcp-server
npm install
npm run build     # compila a dist/
```

Luego registralo en Claude Desktop agregando esto a
`claude_desktop_config.json` (reemplazá la ruta por la absoluta a tu checkout):

```json
{
  "mcpServers": {
    "gym-system": {
      "command": "node",
      "args": ["C:/Users/<tu-usuario>/proyectos-IA/gym-system/mcp-server/dist/index.js"]
    }
  }
}
```

Con el transporte stdio no hace falta ninguna variable de entorno: por defecto
apunta al backend de producción (`https://gym-system-2sb4.onrender.com`); para
apuntar a un backend local, seteá `GYM_API_URL=http://127.0.0.1:4000`.

## Correrlo en HTTP (para el deploy remoto)

El mismo server se sirve por **HTTP** (Streamable HTTP, el estándar actual del
spec) en `http://<host>:<port>/mcp` — pensado para clientes remotos. Variables de
entorno:

| Variable | Default | Qué hace |
|---|---|---|
| `MCP_HOST` | `127.0.0.1` | Host de escucha. `0.0.0.0` lo expone a cualquier cliente con la API key (el default solo escucha en localhost). |
| `MCP_PORT` | `4001` | Puerto de escucha. |
| `MCP_API_KEY` | — | **Requerida en modo HTTP.** El server exige el header `X-MCP-API-Key` con este valor en todas las rutas `/mcp`; falta o no coincide → `401`, y si la variable no está configurada → `503` en todo `/mcp` (fail-closed). `/health` queda sin proteger. Se inyecta como env al desplegar, nunca se hardcodea. |
| `GYM_API_URL` | `https://gym-system-2sb4.onrender.com` | URL base del backend al que los tools llaman (la de producción por defecto; `http://127.0.0.1:4000` para dev). |
| `MCP_CORS_ORIGINS` | defaults de dev | Allowlist de orígenes CORS (coma-separado), misma convención que `CORS_ORIGINS` del backend. Sin header Origin (curl, server-to-server) se permite siempre. |

Cada sesión HTTP tiene su propio estado de login en memoria. Arranque:

```bash
cd mcp-server
npm run dev:http      # dev con tsx
npm run start:http    # corre el build (exige MCP_API_KEY)
```

## Smoke tests

```bash
cd mcp-server
npm run smoke:login   # flujo login → whoami → logout → list_users por stdio (JSON-RPC real)
npm run smoke:http    # transporte HTTP: API key, handshake, tools, SSE, DELETE, CORS y rate limit
```

Ambos hacen `npm run build` antes de correr. Por defecto corren contra el
**backend de producción de Render** (`https://gym-system-2sb4.onrender.com`);
para apuntar al backend local: `GYM_API_URL=http://127.0.0.1:4000`.

> El backend de Render free se duerme tras 15 min de inactividad: si el smoke
> test devuelve timeout, calentalo primero (un `curl` a `/health`).

## Seguridad del transporte HTTP

Dos capas, en orden:

1. **API key compartida** (`X-MCP-API-Key` == `MCP_API_KEY`): barrera primaria.
   Corres antes de cualquier lógica de sesión MCP y sobre las tres rutas `/mcp`
   (POST/GET/DELETE); el modo fail-closed (503 si la variable no está seteada)
   garantiza que olvidarse de configurarla nunca deje el endpoint abierto.
2. **Rate limit** de 30 `POST /mcp` por minuto por IP: acota los intentos de
   login por minuto sin frenar una sesión MCP legítima (tool calls secuenciales
   van muy por debajo de ese techo). Los 401 de la API key corren antes y no
   consumen cuota; el 429 corta sin tocar la lógica de transporte.
