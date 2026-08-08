import { Request, Response } from "express";
import { z } from "zod";
import { pool } from "../../config/db";
import { AuthRequest } from "../../middleware/auth";

// Columnas reales de la tabla "class_bookings" (regla dura: no inventar columnas).
const COLUMNS = "id, class_id, user_id, status, booked_at";

const createBookingSchema = z.object({
  class_id: z.number().int().positive(),
  // user_id opcional: el miembro reserva con su token; el staff lo manda para
  // reservar en nombre de un miembro (mismo patrón que checkins/memberships).
  user_id: z.number().int().positive().optional(),
});

// PUT solo admite la cancelación; la re-reserva se hace con POST de nuevo.
const cancelSchema = z.object({
  status: z.literal("cancelada"),
});

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Reserva (o re-reserva) con control de concurrencia contra el overbooking:
//   1) SELECT ... FOR UPDATE sobre la fila de la clase: dos reservas concurrentes
//      de la misma clase se serializan acá (la segunda espera el lock y al seguir
//      ve el cupo ya ocupado).
//   2) count de 'reservada' >= capacity -> 409 (clase llena).
//   3) El miembro ya tiene una 'reservada' en la clase -> 409.
//   4) Si tiene una fila 'cancelada' se revive (UPDATE a 'reservada'); si no, INSERT.
export async function create(req: AuthRequest, res: Response) {
  const parsed = createBookingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Datos inválidos" });

  const isStaff = req.user!.role === "admin" || req.user!.role === "recepcion";
  const classId = parsed.data.class_id;
  // El miembro reserva siempre para sí mismo; el staff reserva para el user_id del body.
  const userId = isStaff ? parsed.data.user_id : req.user!.id;
  if (isStaff && userId === undefined) {
    return res.status(400).json({ error: "user_id requerido para staff" });
  }

  // El usuario debe existir
  const member = await pool.query("SELECT id FROM users WHERE id = $1", [userId]);
  if (member.rows.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Bloquea la fila de la clase: serializa las reservas concurrentes de la misma clase.
    const classRes = await client.query(
      "SELECT capacity FROM classes WHERE id = $1 FOR UPDATE",
      [classId]
    );
    if (classRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Clase no encontrada" });
    }

    // Decisión de acceso bajo el mismo lock: la membresía activa se valida con el
    // cliente de la transacción (no el pool), después de adquirir el lock de la
    // clase, para que el gate de acceso y la reserva se decidan en el mismo punto
    // de serialización. Misma regla que checkins: 'activa' y sin vencer.
    const active = await client.query(
      `SELECT id FROM memberships
       WHERE user_id = $1 AND status = 'activa' AND end_date >= CURRENT_DATE
       LIMIT 1`,
      [userId]
    );
    if (active.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Sin acceso: membresía vencida o inexistente" });
    }

    // No se reservan clases ya comenzadas o pasadas
    const past = await client.query(
      "SELECT id FROM classes WHERE id = $1 AND schedule_start <= now()",
      [classId]
    );
    if (past.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "La clase ya comenzó" });
    }

    // Cupo: solo cuentan las reservas 'reservada' (las canceladas liberan lugar)
    const booked = await client.query(
      `SELECT count(*)::int AS n FROM class_bookings
       WHERE class_id = $1 AND status = 'reservada'`,
      [classId]
    );
    if (booked.rows[0].n >= classRes.rows[0].capacity) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Clase llena" });
    }

    // ¿El miembro ya tiene una fila en esta clase? FOR UPDATE para que la
    // re-reserva concurrente del mismo usuario tampoco se pise.
    const existing = await client.query(
      `SELECT id, status FROM class_bookings
       WHERE class_id = $1 AND user_id = $2 FOR UPDATE`,
      [classId, userId]
    );

    let booking;
    if (existing.rows.length === 0) {
      const inserted = await client.query(
        `INSERT INTO class_bookings (class_id, user_id) VALUES ($1, $2)
         RETURNING ${COLUMNS}`,
        [classId, userId]
      );
      booking = inserted.rows[0];
    } else if (existing.rows[0].status === "cancelada") {
      // Re-reserva: revive la fila cancelada (el cupo ya se validó arriba)
      const revived = await client.query(
        `UPDATE class_bookings SET status = 'reservada' WHERE id = $1
         RETURNING ${COLUMNS}`,
        [existing.rows[0].id]
      );
      booking = revived.rows[0];
    } else {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Ya tenés una reserva en esta clase" });
    }

    await client.query("COMMIT");
    res.status(201).json(booking);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error(err);
    return res.status(500).json({ error: "Error interno" });
  } finally {
    client.release();
  }
}

export async function list(req: AuthRequest, res: Response) {
  const isStaff = req.user!.role === "admin" || req.user!.role === "recepcion";

  let where = "";
  const values: unknown[] = [];
  if (!isStaff) {
    // El miembro solo ve sus propias reservas
    where = "WHERE b.user_id = $1";
    values.push(req.user!.id);
  } else {
    const conds: string[] = [];
    const params: unknown[] = [];
    let index = 1;
    if (typeof req.query.user_id === "string") {
      const filter = Number(req.query.user_id);
      if (!Number.isInteger(filter) || filter <= 0) {
        return res.status(400).json({ error: "user_id inválido" });
      }
      conds.push(`b.user_id = $${index++}`);
      params.push(filter);
    }
    if (typeof req.query.class_id === "string") {
      const filter = Number(req.query.class_id);
      if (!Number.isInteger(filter) || filter <= 0) {
        return res.status(400).json({ error: "class_id inválido" });
      }
      conds.push(`b.class_id = $${index++}`);
      params.push(filter);
    }
    if (conds.length > 0) {
      where = "WHERE " + conds.join(" AND ");
      values.push(...params);
    }
  }

  const result = await pool.query(
    `SELECT b.id, b.class_id, b.user_id, b.status, b.booked_at, c.name AS class_name
     FROM class_bookings b
     JOIN classes c ON c.id = b.class_id
     ${where}
     ORDER BY b.booked_at DESC`,
    values
  );
  res.json(result.rows);
}

export async function getById(req: AuthRequest, res: Response) {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Id inválido" });

  const result = await pool.query(
    `SELECT b.id, b.class_id, b.user_id, b.status, b.booked_at, c.name AS class_name
     FROM class_bookings b
     JOIN classes c ON c.id = b.class_id
     WHERE b.id = $1`,
    [id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: "No encontrado" });

  if (req.user!.role === "miembro" && result.rows[0].user_id !== req.user!.id) {
    return res.status(403).json({ error: "Sin permisos" });
  }
  res.json(result.rows[0]);
}

// Cancela una reserva (status -> 'cancelada'). El miembro solo puede cancelar la suya.
// El UPDATE condicional cierra la carrera de dos cancelaciones concurrentes: solo la
// primera ve la fila 'reservada' y la segunda recibe 409.
export async function cancel(req: AuthRequest, res: Response) {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Id inválido" });

  const parsed = cancelSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Datos inválidos" });

  const result = await pool.query(
    `SELECT user_id, status FROM class_bookings WHERE id = $1`,
    [id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: "No encontrado" });

  if (req.user!.role === "miembro" && result.rows[0].user_id !== req.user!.id) {
    return res.status(403).json({ error: "Sin permisos" });
  }
  if (result.rows[0].status !== "reservada") {
    return res.status(409).json({ error: "Solo se puede cancelar una reserva activa" });
  }

  const updated = await pool.query(
    `UPDATE class_bookings SET status = 'cancelada'
     WHERE id = $1 AND status = 'reservada'
     RETURNING ${COLUMNS}`,
    [id]
  );
  if (updated.rows.length === 0) {
    return res.status(409).json({ error: "Solo se puede cancelar una reserva activa" });
  }
  res.json(updated.rows[0]);
}

// Solo admin: corregir errores de registro (mismo espíritu que checkins/memberships).
export async function remove(req: Request, res: Response) {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Id inválido" });

  const result = await pool.query("DELETE FROM class_bookings WHERE id = $1 RETURNING id", [id]);
  if (result.rows.length === 0) return res.status(404).json({ error: "No encontrado" });
  res.status(204).send();
}
