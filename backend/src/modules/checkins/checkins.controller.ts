import { Request, Response } from "express";
import { z } from "zod";
import { pool } from "../../config/db";

// Un check-in es un evento inmutable: solo exponemos sus columnas reales.
const COLUMNS = "id, user_id, checkin_time";

const createCheckinSchema = z.object({
  user_id: z.number().int().positive(),
});

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function list(req: Request, res: Response) {
  const filter = req.query.user_id;

  // Filtro opcional por miembro, solo si llega un entero válido
  if (typeof filter === "string") {
    const userId = Number(filter);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: "user_id inválido" });
    }
    const result = await pool.query(
      `SELECT ${COLUMNS} FROM checkins WHERE user_id = $1 ORDER BY checkin_time DESC`,
      [userId]
    );
    return res.json(result.rows);
  }

  const result = await pool.query(
    `SELECT ${COLUMNS} FROM checkins ORDER BY checkin_time DESC`
  );
  res.json(result.rows);
}

export async function getById(req: Request, res: Response) {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Id inválido" });

  const result = await pool.query(
    `SELECT ${COLUMNS} FROM checkins WHERE id = $1`,
    [id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: "No encontrado" });
  res.json(result.rows[0]);
}

export async function create(req: Request, res: Response) {
  const parsed = createCheckinSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Datos inválidos" });

  const { user_id } = parsed.data;

  // 1) El miembro debe existir
  const user = await pool.query("SELECT id FROM users WHERE id = $1", [user_id]);
  if (user.rows.length === 0) return res.status(404).json({ error: "No encontrado" });

  // 2) Control de acceso: solo entra con membresía activa (status='activa' y sin vencer)
  const membership = await pool.query(
    `SELECT id FROM memberships
     WHERE user_id = $1 AND status = 'activa' AND end_date >= CURRENT_DATE
     LIMIT 1`,
    [user_id]
  );
  if (membership.rows.length === 0) {
    return res.status(403).json({ error: "Sin acceso: membresía vencida o inexistente" });
  }

  // 3) Máximo 2 check-ins por día calendario por miembro.
  // Limitación conocida: es check-then-insert sin transacción, así que dos
  // peticiones concurrentes podrían pasar el check. No hay constraint en el
  // esquema (regla dura: no agregar columnas); se endurecería con un
  // SELECT ... FOR UPDATE o advisory lock sobre una fila de control.
  const count = await pool.query(
    `SELECT count(*)::int AS n FROM checkins
     WHERE user_id = $1
       AND checkin_time >= CURRENT_DATE
       AND checkin_time < CURRENT_DATE + INTERVAL '1 day'`,
    [user_id]
  );
  if (count.rows[0].n >= 2) {
    return res.status(409).json({ error: "Límite de check-ins diarios alcanzado" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO checkins (user_id) VALUES ($1) RETURNING ${COLUMNS}`,
      [user_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error interno" });
  }
}

export async function remove(req: Request, res: Response) {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Id inválido" });

  const result = await pool.query("DELETE FROM checkins WHERE id = $1 RETURNING id", [id]);
  if (result.rows.length === 0) return res.status(404).json({ error: "No encontrado" });
  res.status(204).send();
}
