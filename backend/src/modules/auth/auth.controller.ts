import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { pool } from "../../config/db";

// Validación del body de login antes de tocar la DB
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const JWT_EXPIRES_IN = "8h";

// Hash dummy para ejecutar bcrypt.compare aun cuando el email no exista:
// iguala el tiempo de respuesta y evita el timing oracle (no filtra qué
// emails están registrados).
const DUMMY_HASH = "$2b$10$6399AVHpG5OM1CFyJ302OeGFUXWG42YR1Mf5WKOJJpI7KBdznYx2e";

export async function login(req: Request, res: Response) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Email o password inválidos" });
  }

  const { email, password } = parsed.data;
  const result = await pool.query(
    "SELECT id, name, email, password_hash, role FROM users WHERE email = $1",
    [email]
  );
  const user = result.rows[0];

  // Mismo mensaje y mismo status si el email no existe o el password es
  // incorrecto: no se filtra qué emails están registrados.
  const passwordOk = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !passwordOk) {
    return res.status(401).json({ error: "Credenciales inválidas" });
  }

  const token = jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET as string,
    { expiresIn: JWT_EXPIRES_IN }
  );

  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
}
