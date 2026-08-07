import { Request, Response } from "express";
import { pool } from "../../config/db";

// TODO: reemplazar SELECT * por las columnas reales de "routines" y agregar validación con zod

export async function list(req: Request, res: Response) {
  const result = await pool.query("SELECT * FROM routines");
  res.json(result.rows);
}

export async function getById(req: Request, res: Response) {
  const result = await pool.query("SELECT * FROM routines WHERE id = $1", [req.params.id]);
  if (result.rows.length === 0) return res.status(404).json({ error: "No encontrado" });
  res.json(result.rows[0]);
}

export async function create(req: Request, res: Response) {
  // TODO: insertar con los campos del body validados
  res.status(501).json({ error: "Pendiente de implementar" });
}

export async function update(req: Request, res: Response) {
  // TODO: actualizar con los campos del body validados
  res.status(501).json({ error: "Pendiente de implementar" });
}

export async function remove(req: Request, res: Response) {
  await pool.query("DELETE FROM routines WHERE id = $1", [req.params.id]);
  res.status(204).send();
}
