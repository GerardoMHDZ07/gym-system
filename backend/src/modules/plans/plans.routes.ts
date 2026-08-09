import { Router } from "express";
import * as controller from "./plans.controller";
import { requireAuth } from "../../middleware/auth";
import { asyncHandler } from "../../middleware/asyncHandler";

const router = Router();

// Catálogo de planes: cualquier usuario autenticado lo necesita (el miembro ve
// su plan, el staff lo usa al dar de alta una membresía).
router.get("/", requireAuth, asyncHandler(controller.list));

export default router;
