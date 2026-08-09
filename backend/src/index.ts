import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";

import authRoutes from "./modules/auth/auth.routes";
import usersRoutes from "./modules/users/users.routes";
import membershipsRoutes from "./modules/memberships/memberships.routes";
import paymentsRoutes from "./modules/payments/payments.routes";
import checkinsRoutes from "./modules/checkins/checkins.routes";
import classesRoutes from "./modules/classes/classes.routes";
import bookingsRoutes from "./modules/bookings/bookings.routes";
import exercisesRoutes from "./modules/exercises/exercises.routes";
import routinesRoutes from "./modules/routines/routines.routes";
import metricsRoutes from "./modules/metrics/metrics.routes";
import dashboardRoutes from "./modules/dashboard/dashboard.routes";
import plansRoutes from "./modules/plans/plans.routes";

dotenv.config();

// Orígenes permitidos para CORS. El frontend siempre llama a `/api` relativo
// (proxied por Vite en dev, por nginx en prod), así que el Origin que llega al
// backend es el dominio del frontend, no el del backend. Lista por defecto:
// dev (Vite :5173), docker-compose (:8080) y el frontend de Render en prod.
// Se sobreescribe con CORS_ORIGINS (separado por comas) si hiciera falta.
// Si la env var llega vacía (""), se trata como no seteada: un CORS_ORIGINS
// vacío rompería el frontend en silencio (allowlist sin orígenes).
const CORS_ORIGINS = (process.env.CORS_ORIGINS?.trim() ||
  [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8080",
    "https://gym-system-1-xoxy.onrender.com",
  ].join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const app = express();
app.use(
  cors({
    origin: (origin, cb) => {
      // Sin header Origin (curl, health checks, server-to-server) no es una
      // petición de browser: se permite. Con Origin, solo si está en la lista.
      if (!origin || CORS_ORIGINS.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
  })
);
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/memberships", membershipsRoutes);
app.use("/api/payments", paymentsRoutes);
app.use("/api/checkins", checkinsRoutes);
app.use("/api/classes", classesRoutes);
app.use("/api/bookings", bookingsRoutes);
app.use("/api/exercises", exercisesRoutes);
app.use("/api/routines", routinesRoutes);
app.use("/api/metrics", metricsRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/plans", plansRoutes);

// Middleware de error global (Express 4 no captura rechazos de handlers async,
// así que también blindamos unhandled rejections: un error puntual devuelve 500
// en vez de tumbar el server).
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof SyntaxError) {
    return res.status(400).json({ error: "JSON inválido" });
  }
  console.error(err);
  res.status(500).json({ error: "Error interno" });
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Backend corriendo en puerto ${port}`));
