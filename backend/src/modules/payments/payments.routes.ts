import { Router } from "express";
import * as controller from "./payments.controller";
import { requireAuth, requireRole } from "../../middleware/auth";
import { asyncHandler } from "../../middleware/asyncHandler";

const router = Router();

// Lectura: admin/recepcion (todo, con ?user_id=) y miembro (solo lo suyo)
router.get("/", requireAuth, requireRole("admin", "recepcion", "miembro"), asyncHandler(controller.list));
router.get("/:id", requireAuth, requireRole("admin", "recepcion", "miembro"), asyncHandler(controller.getById));

// Escritura: admin/recepcion registran pagos (que renuevan). Un pago es un
// evento financiero inmutable (ledger): no se edita ni se borra una vez creado.
router.post("/", requireAuth, requireRole("admin", "recepcion"), asyncHandler(controller.create));

export default router;
