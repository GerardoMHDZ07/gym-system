import { Router } from "express";
import * as controller from "./users.controller";
import { requireAuth, requireRole } from "../../middleware/auth";

const router = Router();

router.get("/", requireAuth, requireRole("admin", "recepcion"), controller.list);
router.get("/:id", requireAuth, requireRole("admin", "recepcion"), controller.getById);
router.post("/", requireAuth, requireRole("admin", "recepcion"), controller.create);
router.put("/:id", requireAuth, requireRole("admin", "recepcion"), controller.update);
router.delete("/:id", requireAuth, requireRole("admin"), controller.remove);

export default router;
