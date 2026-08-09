import { Router } from "express";
import * as controller from "./exercises.controller";
import { requireAuth, requireRole } from "../../middleware/auth";
import { asyncHandler } from "../../middleware/asyncHandler";

const router = Router();

// Lectura: cualquier usuario autenticado (el catálogo es compartido por todos los roles)
router.get("/", requireAuth, asyncHandler(controller.list));
router.get("/:id", requireAuth, asyncHandler(controller.getById));

// Escritura: admin/recepcion mantienen el catálogo; solo admin borra (misma
// política que classes: dato maestral, no editable por cualquiera).
router.post("/", requireAuth, requireRole("admin", "recepcion"), asyncHandler(controller.create));
router.put("/:id", requireAuth, requireRole("admin", "recepcion"), asyncHandler(controller.update));
router.delete("/:id", requireAuth, requireRole("admin"), asyncHandler(controller.remove));

export default router;
