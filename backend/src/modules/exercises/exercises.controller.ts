import { Request, Response } from "express";
import { z } from "zod";
import { pool } from "../../config/db";

// Columnas reales de la tabla "exercises" (regla dura: no inventar columnas).
const COLUMNS = "id, name, muscle_group, description, video_url";

// Catálogo compartido: name obligatorio; el resto opcional (columnas nullable).
const exerciseSchema = z.object({
  name: z.string().min(1).max(100),
  muscle_group: z.string().max(50).optional().nullable(),
  description: z.string().optional().nullable(),
  video_url: z.string().url().max(255).optional().nullable(),
});

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function list(req: Request, res: Response) {
  const result = await pool.query(`SELECT ${COLUMNS} FROM exercises ORDER BY name`);
  res.json(result.rows);
}

export async function getById(req: Request, res: Response) {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Id inválido" });

  const result = await pool.query(`SELECT ${COLUMNS} FROM exercises WHERE id = $1`, [id]);
  if (result.rows.length === 0) return res.status(404).json({ error: "No encontrado" });
  res.json(result.rows[0]);
}

export async function create(req: Request, res: Response) {
  const parsed = exerciseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Datos inválidos" });

  const data = parsed.data;
  const result = await pool.query(
    `INSERT INTO exercises (name, muscle_group, description, video_url)
     VALUES ($1, $2, $3, $4)
     RETURNING ${COLUMNS}`,
    [data.name, data.muscle_group ?? null, data.description ?? null, data.video_url ?? null]
  );
  res.status(201).json(result.rows[0]);
}

export async function update(req: Request, res: Response) {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Id inválido" });

  const parsed = exerciseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Datos inválidos" });

  const data = parsed.data;
  const result = await pool.query(
    `UPDATE exercises
     SET name = $1, muscle_group = $2, description = $3, video_url = $4
     WHERE id = $5
     RETURNING ${COLUMNS}`,
    [data.name, data.muscle_group ?? null, data.description ?? null, data.video_url ?? null, id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: "No encontrado" });
  res.json(result.rows[0]);
}

export async function remove(req: Request, res: Response) {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Id inválido" });

  const result = await pool.query("DELETE FROM exercises WHERE id = $1 RETURNING id", [id]);
  if (result.rows.length === 0) return res.status(404).json({ error: "No encontrado" });
  res.status(204).send();
}
