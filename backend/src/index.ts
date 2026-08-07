import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import usersRoutes from "./modules/users/users.routes";
import membershipsRoutes from "./modules/memberships/memberships.routes";
import paymentsRoutes from "./modules/payments/payments.routes";
import checkinsRoutes from "./modules/checkins/checkins.routes";
import classesRoutes from "./modules/classes/classes.routes";
import exercisesRoutes from "./modules/exercises/exercises.routes";
import routinesRoutes from "./modules/routines/routines.routes";
import metricsRoutes from "./modules/metrics/metrics.routes";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api/users", usersRoutes);
app.use("/api/memberships", membershipsRoutes);
app.use("/api/payments", paymentsRoutes);
app.use("/api/checkins", checkinsRoutes);
app.use("/api/classes", classesRoutes);
app.use("/api/exercises", exercisesRoutes);
app.use("/api/routines", routinesRoutes);
app.use("/api/metrics", metricsRoutes);

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Backend corriendo en puerto ${port}`));
