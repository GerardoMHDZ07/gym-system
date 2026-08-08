import { Pool, types } from "pg";
import dotenv from "dotenv";

dotenv.config();

// Las columnas DATE (OID 1082) y TIMESTAMP sin zona (OID 1114) se devuelven como
// texto ('YYYY-MM-DD' y 'YYYY-MM-DD HH:MM:SS'): el parser por defecto de pg las
// convierte a hora local del proceso y serializa con un offset dependiente de la
// zona horaria de la máquina (p.ej. '2026-08-08T06:00:00.000Z'), no determinista.
types.setTypeParser(1082, (value: string) => value);
types.setTypeParser(1114, (value: string) => value);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
