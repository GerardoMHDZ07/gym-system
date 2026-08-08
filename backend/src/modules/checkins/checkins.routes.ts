import { Router } from "express";
import * as controller from "./checkins.controller";
import { requireAuth, requireRole } from "../../middleware/auth";

const router = Router();

router.get("/", requireAuth, requireRole("admin", "recepcion"), controller.list);
router.get("/:id", requireAuth, requireRole("admin", "recepcion"), controller.getById);
router.post("/", requireAuth, requireRole("admin", "recepcion"), controller.create);
// Sin PUT: un check-in es un evento inmutable (solo se corrige borrando).
router.delete("/:id", requireAuth, requireRole("admin"), controller.remove);

export default router;
