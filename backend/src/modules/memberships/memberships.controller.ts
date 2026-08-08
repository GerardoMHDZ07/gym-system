import { Request, Response } from "express";
import { z } from "zod";
import { pool } from "../../config/db";
import { AuthRequest } from "../../middleware/auth";

// Columnas reales de la tabla "memberships" (regla dura: no inventar columnas).
const COLUMNS = "id, user_id, plan_id, start_date, end_date, status, created_at";

const createMembershipSchema = z.object({
  user_id: z.number().int().positive(),
  plan_id: z.number().int().positive(),
});

// PUT solo admite la cancelación (las fechas y el estado se derivan del plan y los pagos,
// no se editan a mano).
const cancelSchema = z.object({
  status: z.literal("cancelada"),
});

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Materialización perezosa del estado: cualquier membresía 'activa' cuyo end_date ya
// pasó pasa a 'vencida' en el momento de la lectura. El estado derivado se persiste
// (lazy write-through) para que la tabla siempre quede consistente, sin jobs externos.
async function materializeExpired(params?: { id?: number; user_id?: number }): Promise<void> {
  const conds = ["status = 'activa'", "end_date < CURRENT_DATE"];
  const values: unknown[] = [];
  let index = 1;
  if (params?.id !== undefined) {
    conds.push(`id = $${index++}`);
    values.push(params.id);
  }
  if (params?.user_id !== undefined) {
    conds.push(`user_id = $${index++}`);
    values.push(params.user_id);
  }
  await pool.query(
    `UPDATE memberships SET status = 'vencida' WHERE ${conds.join(" AND ")}`,
    values
  );
}

export async function list(req: AuthRequest, res: Response) {
  const isStaff = req.user!.role === "admin" || req.user!.role === "recepcion";

  let userIdFilter: number | null = null;
  if (!isStaff) {
    // El miembro solo ve sus propias membresías
    userIdFilter = req.user!.id;
  } else if (typeof req.query.user_id === "string") {
    const filter = Number(req.query.user_id);
    if (!Number.isInteger(filter) || filter <= 0) {
      return res.status(400).json({ error: "user_id inválido" });
    }
    userIdFilter = filter;
  }

  if (userIdFilter !== null) {
    await materializeExpired({ user_id: userIdFilter });
    const result = await pool.query(
      `SELECT ${COLUMNS} FROM memberships WHERE user_id = $1 ORDER BY id`,
      [userIdFilter]
    );
    return res.json(result.rows);
  }

  await materializeExpired();
  const result = await pool.query(`SELECT ${COLUMNS} FROM memberships ORDER BY id`);
  res.json(result.rows);
}

export async function getById(req: AuthRequest, res: Response) {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Id inválido" });

  await materializeExpired({ id });
  const result = await pool.query(`SELECT ${COLUMNS} FROM memberships WHERE id = $1`, [id]);
  if (result.rows.length === 0) return res.status(404).json({ error: "No encontrado" });

  // Un miembro solo puede ver sus propias membresías
  if (req.user!.role === "miembro" && result.rows[0].user_id !== req.user!.id) {
    return res.status(403).json({ error: "Sin permisos" });
  }
  res.json(result.rows[0]);
}

export async function create(req: Request, res: Response) {
  const parsed = createMembershipSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Datos inválidos" });

  const { user_id, plan_id } = parsed.data;

  // El usuario debe existir y ser miembro (las membresías son de miembros)
  const user = await pool.query("SELECT id, role FROM users WHERE id = $1", [user_id]);
  if (user.rows.length === 0) return res.status(404).json({ error: "No encontrado" });
  if (user.rows[0].role !== "miembro") {
    return res.status(400).json({ error: "Solo los miembros pueden tener membresía" });
  }

  // El plan debe existir (de ahí salen la duración y, en los pagos, el precio)
  const plan = await pool.query(
    "SELECT id, duration_days FROM membership_plans WHERE id = $1",
    [plan_id]
  );
  if (plan.rows.length === 0) return res.status(404).json({ error: "Plan no encontrado" });

  // Materializar primero: si el usuario tenía una 'activa' ya vencida, no debe bloquear
  await materializeExpired({ user_id });

  // Un usuario no puede tener dos membresías activas simultáneas
  const active = await pool.query(
    "SELECT id FROM memberships WHERE user_id = $1 AND status = 'activa' LIMIT 1",
    [user_id]
  );
  if (active.rows.length > 0) {
    return res.status(409).json({ error: "El usuario ya tiene una membresía activa" });
  }

  // Cast explícito en CURRENT_DATE + $3::int: sin él, Postgres no sabe si sumar
  // días (integer) o un intervalo y responde 42725 (operator is not unique).
  // Límite conocido: el chequeo de membresía activa y el INSERT van sin transacción
  // (check-then-insert), así que dos POST concurrentes para el mismo usuario podrían
  // crear dos membresías activas. Endurecible con SELECT ... FOR UPDATE sobre la
  // fila del user, mismo patrón que usa payments.create.
  const result = await pool.query(
    `INSERT INTO memberships (user_id, plan_id, start_date, end_date, status)
     VALUES ($1, $2, CURRENT_DATE, CURRENT_DATE + $3::int, 'activa')
     RETURNING ${COLUMNS}`,
    [user_id, plan_id, plan.rows[0].duration_days]
  );
  res.status(201).json(result.rows[0]);
}

export async function cancel(req: Request, res: Response) {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Id inválido" });

  const parsed = cancelSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Datos inválidos" });

  // Materializar primero: una membresía 'activa' con end_date pasado ya es 'vencida'
  await materializeExpired({ id });

  const existing = await pool.query("SELECT status FROM memberships WHERE id = $1", [id]);
  if (existing.rows.length === 0) return res.status(404).json({ error: "No encontrado" });
  if (existing.rows[0].status !== "activa") {
    return res.status(409).json({ error: "Solo se puede cancelar una membresía activa" });
  }

  const result = await pool.query(
    `UPDATE memberships SET status = 'cancelada' WHERE id = $1 RETURNING ${COLUMNS}`,
    [id]
  );
  res.json(result.rows[0]);
}

export async function remove(req: Request, res: Response) {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Id inválido" });

  const result = await pool.query("DELETE FROM memberships WHERE id = $1 RETURNING id", [id]);
  if (result.rows.length === 0) return res.status(404).json({ error: "No encontrado" });
  res.status(204).send();
}
