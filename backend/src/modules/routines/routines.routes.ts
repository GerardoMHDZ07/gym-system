import { Router } from "express";
import * as controller from "./routines.controller";
import { requireAuth, requireRole } from "../../middleware/auth";
import { asyncHandler } from "../../middleware/asyncHandler";

const router = Router();

// Lectura: cualquier usuario autenticado (la visibilidad la aplica el controller:
// miembro ve lo asignado, entrenador lo creado por él, staff todo).
router.get("/", requireAuth, asyncHandler(controller.list));
router.get("/:id", requireAuth, asyncHandler(controller.getById));

// Escritura: entrenador (sus propias rutinas, created_by = token) y
// admin/recepcion (cualquiera); solo admin borra.
router.post("/", requireAuth, requireRole("admin", "recepcion", "entrenador"), asyncHandler(controller.create));
router.put("/:id", requireAuth, requireRole("admin", "recepcion", "entrenador"), asyncHandler(controller.update));
router.delete("/:id", requireAuth, requireRole("admin"), asyncHandler(controller.remove));

export default router;
