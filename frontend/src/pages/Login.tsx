import { FormEvent, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Ya con sesión: no mostrar el login (p. ej. al caer en una ruta inexistente).
  // El early return va DESPUÉS de los hooks: si llegara user por un login en
  // vivo, el conteo de hooks no cambia entre renders (Rules of Hooks).
  if (user) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
      const from = (location.state as { from?: { pathname: string } })?.from?.pathname ?? "/";
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo iniciar sesión");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-lime-400 text-2xl font-black text-zinc-950 shadow-lg shadow-lime-400/20">
            G
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Gym System</h1>
            <p className="mt-1 text-sm text-zinc-500">Accedé con tu cuenta del gimnasio</p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="card space-y-4 p-6">
          {error && <p className="rounded-lg border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-300">{error}</p>}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-300">Email</label>
            <input className="input" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@email.com" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-300">Contraseña</label>
            <input className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </div>
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? "Ingresando..." : "Ingresar"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-zinc-600">
          ¿Querés probar? Las credenciales demo están en el README del proyecto.
        </p>
      </div>
    </div>
  );
}
