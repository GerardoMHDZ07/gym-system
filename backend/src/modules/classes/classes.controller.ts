import { Request, Response } from "express";
import { z } from "zod";
import { pool } from "../../config/db";

// Columnas reales de la tabla "classes" (regla dura: no inventar columnas).
const COLUMNS = "id, name, trainer_id, schedule_start, schedule_end, capacity";

// Los horarios viajan como ISO 8601 con zona (p.ej. '2026-08-16T07:00:00.000Z');
// el cast a timestamp se hace en la DB (TimeZone del server = UTC).
const classSchema = z.object({
  name: z.string().min(1).max(80),
  trainer_id: z.number().int().positive(),
  schedule_start: z.string().datetime(),
  schedule_end: z.string().datetime(),
  capacity: z.number().int().positive(),
});

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function validateSchedule(data: z.infer<typeof classSchema>): boolean {
  return new Date(data.schedule_end).getTime() > new Date(data.schedule_start).getTime();
}

// Devuelve el rol del usuario o null si no existe (misma convención que
// memberships.create: 404 para lo inexistente, 400 para el rol incorrecto).
async function getTrainerRole(trainerId: number): Promise<string | null> {
  const result = await pool.query("SELECT role FROM users WHERE id = $1", [trainerId]);
  return result.rows.length > 0 ? result.rows[0].role : null;
}

function validateTrainer(trainerRole: string | null, res: Response): boolean {
  if (trainerRole === null) {
    res.status(404).json({ error: "Trainer no encontrado" });
    return false;
  }
  if (trainerRole !== "entrenador") {
    res.status(400).json({ error: "El trainer debe tener rol entrenador" });
    return false;
  }
  return true;
}

export async function list(req: Request, res: Response) {
  const result = await pool.query(`SELECT ${COLUMNS} FROM classes ORDER BY schedule_start`);
  res.json(result.rows);
}

export async function getById(req: Request, res: Response) {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Id inválido" });

  const result = await pool.query(`SELECT ${COLUMNS} FROM classes WHERE id = $1`, [id]);
  if (result.rows.length === 0) return res.status(404).json({ error: "No encontrado" });
  res.json(result.rows[0]);
}

export async function create(req: Request, res: Response) {
  const parsed = classSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Datos inválidos" });

  const data = parsed.data;
  if (!validateSchedule(data)) {
    return res.status(400).json({ error: "schedule_end debe ser posterior a schedule_start" });
  }
  if (!validateTrainer(await getTrainerRole(data.trainer_id), res)) return;

  const result = await pool.query(
    `INSERT INTO classes (name, trainer_id, schedule_start, schedule_end, capacity)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${COLUMNS}`,
    [data.name, data.trainer_id, data.schedule_start, data.schedule_end, data.capacity]
  );
  res.status(201).json(result.rows[0]);
}

export async function update(req: Request, res: Response) {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Id inválido" });

  const parsed = classSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Datos inválidos" });

  const data = parsed.data;
  if (!validateSchedule(data)) {
    return res.status(400).json({ error: "schedule_end debe ser posterior a schedule_start" });
  }
  if (!validateTrainer(await getTrainerRole(data.trainer_id), res)) return;

  const result = await pool.query(
    `UPDATE classes
     SET name = $1, trainer_id = $2, schedule_start = $3, schedule_end = $4, capacity = $5
     WHERE id = $6
     RETURNING ${COLUMNS}`,
    [data.name, data.trainer_id, data.schedule_start, data.schedule_end, data.capacity, id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: "No encontrado" });
  res.json(result.rows[0]);
}

export async function remove(req: Request, res: Response) {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Id inválido" });

  const result = await pool.query("DELETE FROM classes WHERE id = $1 RETURNING id", [id]);
  if (result.rows.length === 0) return res.status(404).json({ error: "No encontrado" });
  res.status(204).send();
}
