import { Request, Response } from "express";
import bcrypt from "bcrypt";
import { z } from "zod";
import { pool } from "../../config/db";
import { AuthRequest } from "../../middleware/auth";

// Columnas públicas: nunca exponer password_hash
const PUBLIC_COLUMNS = "id, name, email, role, created_at";

const createUserSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(160),
  // bcrypt trunca a 72 bytes: no aceptar más para evitar colisiones por truncado
  password: z.string().min(8).max(72),
  role: z.enum(["admin", "recepcion", "entrenador", "miembro"]),
});

const updateUserSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    email: z.string().email().max(160).optional(),
    password: z.string().min(8).max(72).optional(),
    role: z.enum(["admin", "recepcion", "entrenador", "miembro"]).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Debe enviar al menos un campo para actualizar",
  });

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "23505"
  );
}

export async function list(_req: Request, res: Response) {
  const result = await pool.query(
    `SELECT ${PUBLIC_COLUMNS} FROM users ORDER BY id`
  );
  res.json(result.rows);
}

export async function getById(req: Request, res: Response) {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Id inválido" });

  const result = await pool.query(
    `SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1`,
    [id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: "No encontrado" });
  res.json(result.rows[0]);
}

export async function create(req: AuthRequest, res: Response) {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Datos inválidos" });

  const { name, email, password, role } = parsed.data;

  // Solo un admin puede crear otro admin
  if (role === "admin" && req.user?.role !== "admin") {
    return res.status(403).json({ error: "Sin permisos" });
  }

  const password_hash = await bcrypt.hash(password, 10);
  try {
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING ${PUBLIC_COLUMNS}`,
      [name, email, password_hash, role]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: "Email ya registrado" });
    }
    console.error(err);
    return res.status(500).json({ error: "Error interno" });
  }
}

export async function update(req: AuthRequest, res: Response) {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Id inválido" });

  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Datos inválidos" });

  const { name, email, password, role } = parsed.data;

  // Recepcion edita solo nombre/email; role y password son exclusivos de admin
  const isRecepcion = req.user?.role === "recepcion";
  if (isRecepcion && (password !== undefined || role !== undefined)) {
    return res.status(403).json({ error: "Sin permisos" });
  }

  const existing = await pool.query("SELECT id FROM users WHERE id = $1", [id]);
  if (existing.rows.length === 0) return res.status(404).json({ error: "No encontrado" });

  const sets: string[] = [];
  const values: unknown[] = [];
  let index = 1;

  if (name !== undefined) {
    sets.push(`name = $${index++}`);
    values.push(name);
  }
  if (email !== undefined) {
    sets.push(`email = $${index++}`);
    values.push(email);
  }
  if (role !== undefined) {
    sets.push(`role = $${index++}`);
    values.push(role);
  }
  if (password !== undefined) {
    sets.push(`password_hash = $${index++}`);
    values.push(await bcrypt.hash(password, 10));
  }

  values.push(id);
  try {
    const result = await pool.query(
      `UPDATE users SET ${sets.join(", ")} WHERE id = $${index}
       RETURNING ${PUBLIC_COLUMNS}`,
      values
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: "Email ya registrado" });
    }
    console.error(err);
    return res.status(500).json({ error: "Error interno" });
  }
}

export async function remove(req: Request, res: Response) {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Id inválido" });

  const result = await pool.query("DELETE FROM users WHERE id = $1 RETURNING id", [id]);
  if (result.rows.length === 0) return res.status(404).json({ error: "No encontrado" });
  res.status(204).send();
}
