import { Router } from "express";
import * as controller from "./memberships.controller";
import { requireAuth, requireRole } from "../../middleware/auth";
import { asyncHandler } from "../../middleware/asyncHandler";

const router = Router();

// Lectura: admin/recepcion (todo, con ?user_id=) y miembro (solo lo suyo)
router.get("/", requireAuth, requireRole("admin", "recepcion", "miembro"), asyncHandler(controller.list));
router.get("/:id", requireAuth, requireRole("admin", "recepcion", "miembro"), asyncHandler(controller.getById));

// Escritura: admin/recepcion crean; solo admin cancela o borra
router.post("/", requireAuth, requireRole("admin", "recepcion"), asyncHandler(controller.create));
router.put("/:id", requireAuth, requireRole("admin"), asyncHandler(controller.cancel));
router.delete("/:id", requireAuth, requireRole("admin"), asyncHandler(controller.remove));

export default router;
