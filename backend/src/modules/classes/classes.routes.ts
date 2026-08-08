import { Router } from "express";
import * as controller from "./classes.controller";
import { requireAuth, requireRole } from "../../middleware/auth";
import { asyncHandler } from "../../middleware/asyncHandler";

const router = Router();

// Lectura: cualquier usuario autenticado (los miembros necesitan ver el catálogo)
router.get("/", requireAuth, asyncHandler(controller.list));
router.get("/:id", requireAuth, asyncHandler(controller.getById));

// Escritura: admin/recepcion gestionan el catálogo; solo admin borra
router.post("/", requireAuth, requireRole("admin", "recepcion"), asyncHandler(controller.create));
router.put("/:id", requireAuth, requireRole("admin", "recepcion"), asyncHandler(controller.update));
router.delete("/:id", requireAuth, requireRole("admin"), asyncHandler(controller.remove));

export default router;
