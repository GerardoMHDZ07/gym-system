import { Router } from "express";
import * as controller from "./bookings.controller";
import { requireAuth, requireRole } from "../../middleware/auth";
import { asyncHandler } from "../../middleware/asyncHandler";

const router = Router();

// Lectura: el miembro solo ve lo suyo; admin/recepcion todo (con ?user_id= o ?class_id=)
router.get("/", requireAuth, requireRole("admin", "recepcion", "miembro"), asyncHandler(controller.list));
router.get("/:id", requireAuth, requireRole("admin", "recepcion", "miembro"), asyncHandler(controller.getById));

// Escritura: miembro (self-service) y admin/recepcion (en nombre de un miembro)
// reservan; cancelar puede hacerlo el dueño o el staff; DELETE solo admin
// (corregir errores de registro).
router.post("/", requireAuth, requireRole("admin", "recepcion", "miembro"), asyncHandler(controller.create));
router.put("/:id", requireAuth, requireRole("admin", "recepcion", "miembro"), asyncHandler(controller.cancel));
router.delete("/:id", requireAuth, requireRole("admin"), asyncHandler(controller.remove));

export default router;
