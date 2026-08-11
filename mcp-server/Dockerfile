FROM node:20-alpine
WORKDIR /app
# package-lock.json incluido para reproducibilidad; npm install respeta el
# allowScripts de package.json (postinstall de esbuild).
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
# Default del transporte HTTP (MCP_PORT/MCP_HOST se inyectan al desplegar).
# Env REQUERIDA en el deploy (no en la imagen): MCP_API_KEY — el server
# responde 503 en /mcp si no está configurada (fail-closed). Opcionales:
# MCP_CORS_ORIGINS (allowlist CORS) y GYM_API_URL (URL del backend).
EXPOSE 4001
# El transporte HTTP (dist/http.js), NO dist/index.js (entrypoint stdio,
# solo para Claude Desktop local).
CMD ["npm", "run", "start:http"]
