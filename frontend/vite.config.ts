/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // En dev, /api se proxea al backend local (en prod lo hace nginx).
    proxy: {
      "/api": { target: "http://127.0.0.1:4000", changeOrigin: true },
    },
  },
  // Suite de tests del frontend: jsdom como DOM y setup común en
  // src/test/setup.ts (matchers de jest-dom + cleanup).
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
  },
});
