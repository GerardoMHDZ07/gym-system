import { Router } from "express";
import * as controller from "./metrics.controller";
import { requireAuth, requireRole } from "../../middleware/auth";
import { asyncHandler } from "../../middleware/asyncHandler";

const router = Router();

// Lectura: cualquier usuario autenticado (la visibilidad la aplica el controller:
// miembro solo lo suyo, staff todo con ?user_id=).
router.get("/", requireAuth, asyncHandler(controller.list));
router.get("/:id", requireAuth, asyncHandler(controller.getById));

// Escritura: el miembro se mide con su token (sin user_id, no puede falsificar);
// admin/recepcion/entrenador registran en nombre de un miembro (con user_id).
// El controller valida la propiedad en el PUT; solo admin borra.
router.post("/", requireAuth, asyncHandler(controller.create));
router.put("/:id", requireAuth, asyncHandler(controller.update));
router.delete("/:id", requireAuth, requireRole("admin"), asyncHandler(controller.remove));

export default router;
