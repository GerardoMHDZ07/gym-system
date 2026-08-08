import { Request, Response } from "express";
import { z } from "zod";
import { pool } from "../../config/db";
import { AuthRequest } from "../../middleware/auth";

// Columnas reales de la tabla "payments" (regla dura: no inventar columnas).
const PAYMENT_COLUMNS = "id, membership_id, amount, payment_date, method, status";
const MEMBERSHIP_COLUMNS = "id, user_id, plan_id, start_date, end_date, status, created_at";

const createPaymentSchema = z.object({
  membership_id: z.number().int().positive(),
  amount: z.number().positive(),
  // Métodos aceptados. status solo admite 'completado' por ahora: la renovación
  // ocurre porque el pago se registra como completado.
  method: z.enum(["efectivo", "tarjeta", "transferencia"]),
  status: z.enum(["completado"]).optional(),
});

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Registra el pago Y renueva la membresía en la misma transacción:
//   - 'activa'  -> end_date = end_date actual + duration_days del plan (sin solaparse)
//   - 'vencida' -> end_date = hoy + duration_days, status vuelve a 'activa'
//   - 'cancelada' -> 409 (no renovable; la baja es voluntaria y definitiva)
// El SELECT ... FOR UPDATE bloquea la fila de la membresía: dos pagos concurrentes
// no pueden renovar dos veces desde el mismo end_date.
export async function create(req: Request, res: Response) {
  const parsed = createPaymentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Datos inválidos" });

  const { membership_id, amount, method } = parsed.data;
  const status = parsed.data.status ?? "completado";

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const membershipRes = await client.query(
      `SELECT m.id, m.status, m.end_date, p.duration_days
       FROM memberships m
       JOIN membership_plans p ON p.id = m.plan_id
       WHERE m.id = $1
       FOR UPDATE`,
      [membership_id]
    );
    if (membershipRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Membresía no encontrada" });
    }

    // Materialización en el momento del pago: si el end_date ya pasó, la membresía
    // pasa a 'vencida' en la DB (y se reactiva desde hoy, no se extiende desde una
    // fecha vieja). El estado efectivo se deriva de la fila ya bloqueada: si el
    // UPDATE de materialización tocó la fila, estaba 'activa' y vencida.
    const materialized = await client.query(
      `UPDATE memberships SET status = 'vencida'
       WHERE id = $1 AND status = 'activa' AND end_date < CURRENT_DATE`,
      [membership_id]
    );
    const { status: fetchedStatus, duration_days } = membershipRes.rows[0];
    const currentStatus = (materialized.rowCount ?? 0) > 0 ? "vencida" : fetchedStatus;

    if (currentStatus === "cancelada") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "No se puede renovar una membresía cancelada" });
    }

    // end_date nuevo: desde el actual si seguía activa, desde hoy si estaba vencida
    const newEnd = currentStatus === "activa" ? `end_date + $2::int` : `CURRENT_DATE + $2::int`;

    const paymentRes = await client.query(
      `INSERT INTO payments (membership_id, amount, method, status)
       VALUES ($1, $2, $3, $4)
       RETURNING ${PAYMENT_COLUMNS}`,
      [membership_id, amount, method, status]
    );

    const membershipUpdate = await client.query(
      `UPDATE memberships
       SET end_date = ${newEnd}, status = 'activa'
       WHERE id = $1
       RETURNING ${MEMBERSHIP_COLUMNS}`,
      [membership_id, duration_days]
    );

    await client.query("COMMIT");
    res.status(201).json({
      payment: paymentRes.rows[0],
      membership: membershipUpdate.rows[0],
    });
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
    // El miembro solo ve sus propios pagos (por el dueño de la membresía)
    where = "WHERE m.user_id = $1";
    values.push(req.user!.id);
  } else if (typeof req.query.user_id === "string") {
    const filter = Number(req.query.user_id);
    if (!Number.isInteger(filter) || filter <= 0) {
      return res.status(400).json({ error: "user_id inválido" });
    }
    where = "WHERE m.user_id = $1";
    values.push(filter);
  }

  const result = await pool.query(
    `SELECT p.id, p.membership_id, p.amount, p.payment_date, p.method, p.status, m.user_id
     FROM payments p
     JOIN memberships m ON m.id = p.membership_id
     ${where}
     ORDER BY p.id`,
    values
  );
  res.json(result.rows);
}

export async function getById(req: AuthRequest, res: Response) {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Id inválido" });

  const result = await pool.query(
    `SELECT p.id, p.membership_id, p.amount, p.payment_date, p.method, p.status, m.user_id
     FROM payments p
     JOIN memberships m ON m.id = p.membership_id
     WHERE p.id = $1`,
    [id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: "No encontrado" });

  if (req.user!.role === "miembro" && result.rows[0].user_id !== req.user!.id) {
    return res.status(403).json({ error: "Sin permisos" });
  }
  res.json(result.rows[0]);
}
// Un pago es un evento financiero inmutable (ledger): no hay UPDATE ni DELETE.
// Anular/reembolsar implica decidir si se revierte el end_date de la membresía,
// si se corta el acceso de inmediato y si el rembolso es parcial — decisión de
// negocio que merece su propio grill-me (trabajo futuro).
