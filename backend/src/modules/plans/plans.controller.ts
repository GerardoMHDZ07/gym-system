import { Request, Response } from "express";
import { pool } from "../../config/db";

// Columnas reales de la tabla "membership_plans" (regla dura: no inventar columnas).
// El catálogo es de solo lectura: los planes los define el gimnasio (decisión
// de la Fase 8 para que la UI del alta de membresías muestre nombre y precio).
// price es NUMERIC y pg lo devuelve como string por defecto: se castea a
// float8 para que el JSON lleve número (misma convención que metrics).
const COLUMNS = "id, name, duration_days, price::float8 AS price, description";

export async function list(_req: Request, res: Response) {
  const result = await pool.query(`SELECT ${COLUMNS} FROM membership_plans ORDER BY duration_days`);
  res.json(result.rows);
}
