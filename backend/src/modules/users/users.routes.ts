import { Router } from "express";
import * as controller from "./users.controller";
import { requireAuth } from "../../middleware/auth";

const router = Router();

router.get("/", requireAuth, controller.list);
router.get("/:id", requireAuth, controller.getById);
router.post("/", requireAuth, controller.create);
router.put("/:id", requireAuth, controller.update);
router.delete("/:id", requireAuth, controller.remove);

export default router;
