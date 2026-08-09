import { Request, Response } from "express";
import { z } from "zod";
import type { Pool, PoolClient } from "pg";
import { pool } from "../../config/db";
import { AuthRequest } from "../../middleware/auth";

// Columnas reales de las tablas (regla dura: no inventar columnas).
// exercise_name es un alias de JOIN para lectura (mismo espíritu que
// class_name en bookings): la fila no se inventa, solo se embebe el nombre.
const ROUTINE_COLUMNS = "id, name, created_by, assigned_to, notes, created_at";

// Un ejercicio dentro de la rutina. order_index opcional: si no llega, se usa la
// posición en el array del body (el frontend manda la rutina ya ordenada).
const routineExerciseSchema = z.object({
  exercise_id: z.number().int().positive(),
  sets: z.number().int().positive(),
  reps: z.number().int().positive(),
  order_index: z.number().int().nonnegative().optional(),
  rest_seconds: z.number().int().positive().optional(),
});

// La rutina es un agregado: name + a quién se asigna + la lista de ejercicios.
// created_by NO está en el body: sale siempre del token (no se puede falsificar).
const routineSchema = z.object({
  name: z.string().min(1).max(100),
  assigned_to: z.number().int().positive(),
  notes: z.string().optional().nullable(),
  exercises: z.array(routineExerciseSchema),
});

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

type AnyQueryable = Pool | PoolClient;

// Ejercicios de una rutina con el nombre embebido, en orden de ejecución.
// re.id como tiebreaker: el schema permite order_index repetidos y sin el segundo
// criterio el orden quedaría dependiente de la DB.
async function getExercises(client: AnyQueryable, routineId: number) {
  const result = await client.query(
    `SELECT re.id, re.exercise_id, e.name AS exercise_name, re.sets, re.reps,
            re.order_index, re.rest_seconds
     FROM routine_exercises re
     JOIN exercises e ON e.id = re.exercise_id
     WHERE re.routine_id = $1
     ORDER BY re.order_index, re.id`,
    [routineId]
  );
  return result.rows;
}

async function routineWithExercises(client: AnyQueryable, routineId: number) {
  const routine = await client.query(`SELECT ${ROUTINE_COLUMNS} FROM routines WHERE id = $1`, [routineId]);
  if (routine.rows.length === 0) return null;
  return { ...routine.rows[0], exercises: await getExercises(client, routineId) };
}

// Valida que assigned_to exista y sea miembro (misma convención que
// memberships.create: 404 para lo inexistente, 400 para el rol incorrecto).
// Unión discriminada: si !ok, status y error están garantizados.
type AssignedCheck = { ok: true } | { ok: false; status: number; error: string };
async function validateAssignedTo(client: AnyQueryable, userId: number): Promise<AssignedCheck> {
  const result = await client.query("SELECT role FROM users WHERE id = $1", [userId]);
  if (result.rows.length === 0) return { ok: false, status: 404, error: "Usuario no encontrado" };
  if (result.rows[0].role !== "miembro") {
    return { ok: false, status: 400, error: "Solo los miembros pueden tener rutina asignada" };
  }
  return { ok: true };
}

// Todos los exercise_id del body deben existir en el catálogo (se deduplican
// porque ANY() devuelve cada id una sola vez aunque se repita en el array).
async function validateExercisesExist(client: AnyQueryable, exerciseIds: number[]): Promise<boolean> {
  const unique = [...new Set(exerciseIds)];
  if (unique.length === 0) return true;
  const result = await client.query("SELECT id FROM exercises WHERE id = ANY($1::int[])", [unique]);
  return result.rows.length === unique.length;
}

// Crea la rutina Y sus ejercicios en la misma transacción: o queda la rutina
// completa o no queda nada (nunca una rutina sin ejercicios o a medias).
export async function create(req: AuthRequest, res: Response) {
  const parsed = routineSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Datos inválidos" });

  const { name, assigned_to, notes } = parsed.data;
  // order_index por defecto = posición en el array del body
  const exercises = parsed.data.exercises.map((ex, i) => ({ ...ex, order_index: ex.order_index ?? i }));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const assigned = await validateAssignedTo(client, assigned_to);
    if (!assigned.ok) {
      await client.query("ROLLBACK");
      return res.status(assigned.status).json({ error: assigned.error });
    }

    if (!(await validateExercisesExist(client, exercises.map((e) => e.exercise_id)))) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Alguno de los ejercicios no existe" });
    }

    const routineRes = await client.query(
      `INSERT INTO routines (name, created_by, assigned_to, notes)
       VALUES ($1, $2, $3, $4)
       RETURNING ${ROUTINE_COLUMNS}`,
      [name, req.user!.id, assigned_to, notes ?? null]
    );
    const routineId = routineRes.rows[0].id;

    for (const ex of exercises) {
      await client.query(
        `INSERT INTO routine_exercises (routine_id, exercise_id, sets, reps, order_index, rest_seconds)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [routineId, ex.exercise_id, ex.sets, ex.reps, ex.order_index, ex.rest_seconds ?? null]
      );
    }

    await client.query("COMMIT");
    res.status(201).json(await routineWithExercises(pool, routineId));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error(err);
    return res.status(500).json({ error: "Error interno" });
  } finally {
    client.release();
  }
}

// PUT reemplaza la rutina completa (full replace): los ejercicios viejos se
// borran y se insertan los del body, en la misma transacción.
export async function update(req: AuthRequest, res: Response) {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Id inválido" });

  const parsed = routineSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Datos inválidos" });

  const { name, assigned_to, notes } = parsed.data;
  const exercises = parsed.data.exercises.map((ex, i) => ({ ...ex, order_index: ex.order_index ?? i }));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query("SELECT created_by FROM routines WHERE id = $1 FOR UPDATE", [id]);
    if (existing.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "No encontrado" });
    }

    // El entrenador solo edita sus propias rutinas; admin/recepcion cualquiera
    if (req.user!.role === "entrenador" && existing.rows[0].created_by !== req.user!.id) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Sin permisos" });
    }

    const assigned = await validateAssignedTo(client, assigned_to);
    if (!assigned.ok) {
      await client.query("ROLLBACK");
      return res.status(assigned.status).json({ error: assigned.error });
    }

    if (!(await validateExercisesExist(client, exercises.map((e) => e.exercise_id)))) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Alguno de los ejercicios no existe" });
    }

    await client.query(
      `UPDATE routines SET name = $1, assigned_to = $2, notes = $3 WHERE id = $4`,
      [name, assigned_to, notes ?? null, id]
    );

    // Full replace del detalle
    await client.query("DELETE FROM routine_exercises WHERE routine_id = $1", [id]);
    for (const ex of exercises) {
      await client.query(
        `INSERT INTO routine_exercises (routine_id, exercise_id, sets, reps, order_index, rest_seconds)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, ex.exercise_id, ex.sets, ex.reps, ex.order_index, ex.rest_seconds ?? null]
      );
    }

    await client.query("COMMIT");
    res.json(await routineWithExercises(pool, id));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error(err);
    return res.status(500).json({ error: "Error interno" });
  } finally {
    client.release();
  }
}

// El miembro ve solo las rutinas que le asignaron; el entrenador solo las que
// creó; admin/recepcion ven todo (con ?user_id= opcional, filtra por asignado).
export async function list(req: AuthRequest, res: Response) {
  let where = "";
  const values: unknown[] = [];
  if (req.user!.role === "miembro") {
    where = "WHERE assigned_to = $1";
    values.push(req.user!.id);
  } else if (req.user!.role === "entrenador") {
    where = "WHERE created_by = $1";
    values.push(req.user!.id);
  } else if (typeof req.query.user_id === "string") {
    const filter = Number(req.query.user_id);
    if (!Number.isInteger(filter) || filter <= 0) {
      return res.status(400).json({ error: "user_id inválido" });
    }
    where = "WHERE assigned_to = $1";
    values.push(filter);
  }

  const result = await pool.query(
    `SELECT ${ROUTINE_COLUMNS} FROM routines ${where} ORDER BY id`,
    values
  );
  res.json(result.rows);
}

export async function getById(req: AuthRequest, res: Response) {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Id inválido" });

  const result = await pool.query(
    `SELECT ${ROUTINE_COLUMNS} FROM routines WHERE id = $1`,
    [id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: "No encontrado" });

  const routine = result.rows[0];
  // Mismo filtro de visibilidad que list: miembro solo lo asignado, entrenador
  // solo lo creado por él, staff cualquier.
  if (req.user!.role === "miembro" && routine.assigned_to !== req.user!.id) {
    return res.status(403).json({ error: "Sin permisos" });
  }
  if (req.user!.role === "entrenador" && routine.created_by !== req.user!.id) {
    return res.status(403).json({ error: "Sin permisos" });
  }

  res.json({ ...routine, exercises: await getExercises(pool, id) });
}

// Solo admin: corregir errores de registro (mismo espíritu que el resto).
export async function remove(req: Request, res: Response) {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Id inválido" });

  const result = await pool.query("DELETE FROM routines WHERE id = $1 RETURNING id", [id]);
  if (result.rows.length === 0) return res.status(404).json({ error: "No encontrado" });
  res.status(204).send();
}
