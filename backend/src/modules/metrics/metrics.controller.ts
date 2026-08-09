import { Request, Response } from "express";
import { z } from "zod";
import { pool } from "../../config/db";
import { AuthRequest } from "../../middleware/auth";

// Columnas reales de la tabla "body_metrics" (regla dura: no inventar columnas).
// weight_kg/body_fat_pct son NUMERIC y pg los devuelve como string por defecto:
// el cast a float8 los serializa como números en el JSON (más útil para un
// gráfico de progreso). No se toca el parser global para no cambiar el contrato
// de payments.amount.
const SELECT = "id, user_id, date, weight_kg::float8 AS weight_kg, body_fat_pct::float8 AS body_fat_pct, notes";

// Una medición por día calendario por miembro (decisión del grill-me): POST con
// la misma fecha que una existente -> 409. weight_kg/body_fat_pct opcionales
// individualmente pero al menos uno obligatorio (una medición vacía no aporta).
const createSchema = z
  .object({
    // user_id opcional: el miembro se mide con su token; el staff lo manda para
    // registrar en nombre de un miembro (mismo patrón que checkins/bookings).
    user_id: z.number().int().positive().optional(),
    // date opcional: por defecto hoy. Formato 'YYYY-MM-DD' (la columna es DATE).
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    weight_kg: z.number().positive().max(999.99).optional(), // NUMERIC(5,2)
    body_fat_pct: z.number().min(0).max(99.99).optional(), // NUMERIC(4,2)
    notes: z.string().max(2000).optional().nullable(),
  })
  .refine((d) => d.weight_kg !== undefined || d.body_fat_pct !== undefined, {
    message: "Se requiere al menos weight_kg o body_fat_pct",
  });

// PUT corrige la medición existente: solo los valores (la fecha identifica la
// serie y se fija al crear). Los campos omitidos quedan iguales.
const updateSchema = z
  .object({
    weight_kg: z.number().positive().max(999.99).optional(),
    body_fat_pct: z.number().min(0).max(99.99).optional(),
    notes: z.string().max(2000).optional().nullable(),
  })
  .refine((d) => d.weight_kg !== undefined || d.body_fat_pct !== undefined || d.notes !== undefined, {
    message: "No hay nada para actualizar",
  });

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function isStaff(role: string): boolean {
  return role === "admin" || role === "recepcion" || role === "entrenador";
}

// Registra la medición en una transacción, serializando sobre la fila del user
// (SELECT ... FOR UPDATE, mismo patrón que bookings con la fila de la clase):
//   - el user debe existir (404);
//   - fecha futura -> 400 (no se puede medir en el futuro);
//   - una medición para ese user+date ya existe -> 409 (una por día).
export async function create(req: AuthRequest, res: Response) {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Datos inválidos" });

  const data = parsed.data;
  const staff = isStaff(req.user!.role);
  // El miembro se mide siempre para sí mismo; el staff registra para el user_id del body.
  const userId = staff ? data.user_id : req.user!.id;
  if (staff && userId === undefined) {
    return res.status(400).json({ error: "user_id requerido para staff" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock de la fila del user: serializa los POST concurrentes del mismo miembro
    // (dos mediciones simultáneas no pueden ganar ambas el cupo del día).
    const user = await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [userId]);
    if (user.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    if (data.date !== undefined) {
      const future = await client.query("SELECT 1 WHERE $1::date > CURRENT_DATE", [data.date]);
      if (future.rows.length > 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "No se puede registrar una medición futura" });
      }
    }

    const dup = await client.query(
      `SELECT id FROM body_metrics
       WHERE user_id = $1 AND date = COALESCE($2::date, CURRENT_DATE)`,
      [userId, data.date]
    );
    if (dup.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Ya existe una medición para ese día" });
    }

    const inserted = await client.query(
      `INSERT INTO body_metrics (user_id, date, weight_kg, body_fat_pct, notes)
       VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5)
       RETURNING ${SELECT}`,
      [userId, data.date, data.weight_kg ?? null, data.body_fat_pct ?? null, data.notes ?? null]
    );

    await client.query("COMMIT");
    res.status(201).json(inserted.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error(err);
    return res.status(500).json({ error: "Error interno" });
  } finally {
    client.release();
  }
}

// El miembro ve solo sus métricas; el staff (admin/recepcion/entrenador) todas,
// con ?user_id= opcional. Serie ascendente por fecha (la forma natural del
// progreso físico).
export async function list(req: AuthRequest, res: Response) {
  let where = "";
  const values: unknown[] = [];
  if (!isStaff(req.user!.role)) {
    where = "WHERE user_id = $1";
    values.push(req.user!.id);
  } else if (typeof req.query.user_id === "string") {
    const filter = Number(req.query.user_id);
    if (!Number.isInteger(filter) || filter <= 0) {
      return res.status(400).json({ error: "user_id inválido" });
    }
    where = "WHERE user_id = $1";
    values.push(filter);
  }

  const result = await pool.query(
    `SELECT ${SELECT} FROM body_metrics ${where} ORDER BY date, id`,
    values
  );
  res.json(result.rows);
}

export async function getById(req: AuthRequest, res: Response) {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Id inválido" });

  const result = await pool.query(`SELECT ${SELECT} FROM body_metrics WHERE id = $1`, [id]);
  if (result.rows.length === 0) return res.status(404).json({ error: "No encontrado" });

  // El miembro solo ve sus propias métricas (dato personal de salud)
  if (!isStaff(req.user!.role) && result.rows[0].user_id !== req.user!.id) {
    return res.status(403).json({ error: "Sin permisos" });
  }
  res.json(result.rows[0]);
}

// Corrige los valores de una medición existente (p. ej. un peso mal tipeado).
// La fecha no se toca: identifica la posición en la serie.
export async function update(req: AuthRequest, res: Response) {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Id inválido" });

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Datos inválidos" });
  const data = parsed.data;

  const existing = await pool.query("SELECT user_id FROM body_metrics WHERE id = $1", [id]);
  if (existing.rows.length === 0) return res.status(404).json({ error: "No encontrado" });

  if (!isStaff(req.user!.role) && existing.rows[0].user_id !== req.user!.id) {
    return res.status(403).json({ error: "Sin permisos" });
  }

  // UPDATE dinámico: solo los campos presentes en el body
  const sets: string[] = [];
  const values: unknown[] = [];
  let index = 1;
  if (data.weight_kg !== undefined) {
    sets.push(`weight_kg = $${index++}`);
    values.push(data.weight_kg);
  }
  if (data.body_fat_pct !== undefined) {
    sets.push(`body_fat_pct = $${index++}`);
    values.push(data.body_fat_pct);
  }
  if (data.notes !== undefined) {
    sets.push(`notes = $${index++}`);
    values.push(data.notes);
  }

  const result = await pool.query(
    `UPDATE body_metrics SET ${sets.join(", ")} WHERE id = $${index} RETURNING ${SELECT}`,
    [...values, id]
  );
  res.json(result.rows[0]);
}

// Solo admin: corregir errores de registro (mismo espíritu que el resto).
export async function remove(req: Request, res: Response) {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Id inválido" });

  const result = await pool.query("DELETE FROM body_metrics WHERE id = $1 RETURNING id", [id]);
  if (result.rows.length === 0) return res.status(404).json({ error: "No encontrado" });
  res.status(204).send();
}
