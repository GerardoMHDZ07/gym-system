import { Router } from "express";
import * as controller from "./users.controller";
import { requireAuth, requireRole } from "../../middleware/auth";

const router = Router();

// Lectura: admin/recepcion y también entrenador (necesita el listado de
// miembros para asignarles rutinas y registrarles métricas — decisión de la
// Fase 8). Solo columnas públicas: sin password_hash.
router.get("/", requireAuth, requireRole("admin", "recepcion", "entrenador"), controller.list);
router.get("/:id", requireAuth, requireRole("admin", "recepcion", "entrenador"), controller.getById);
router.post("/", requireAuth, requireRole("admin", "recepcion"), controller.create);
router.put("/:id", requireAuth, requireRole("admin", "recepcion"), controller.update);
router.delete("/:id", requireAuth, requireRole("admin"), controller.remove);

export default router;
