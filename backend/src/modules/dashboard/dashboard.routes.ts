import { Router } from "express";
import * as controller from "./dashboard.controller";
import { requireAuth, requireRole } from "../../middleware/auth";
import { asyncHandler } from "../../middleware/asyncHandler";

const router = Router();

// Analytics de negocio (incluye ingresos): solo admin/recepcion (decisión del
// grill-me — el entrenador no ve datos financieros).
router.get("/summary", requireAuth, requireRole("admin", "recepcion"), asyncHandler(controller.summary));

export default router;
