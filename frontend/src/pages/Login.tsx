import { FormEvent, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";

const DEMO = [
  { role: "Admin", email: "admin@gym.local" },
  { role: "Recepción", email: "recepcion@gym.local" },
  { role: "Entrenador", email: "carla@gym.local" },
  { role: "Miembro", email: "miguel@gym.local" },
];

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Ya con sesión: no mostrar el login (p. ej. al caer en una ruta inexistente)
  if (user) return <Navigate to="/" replace />;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
            <input className="input" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@gym.local" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-300">Contraseña</label>
            <input className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="demo1234" />
          </div>
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? "Ingresando..." : "Ingresar"}
          </button>
        </form>

        <div className="mt-6">
          <p className="mb-2 text-center text-xs uppercase tracking-wider text-zinc-600">Cuentas demo · password <code className="text-zinc-400">demo1234</code></p>
          <div className="grid grid-cols-2 gap-2">
            {DEMO.map((d) => (
              <button
                key={d.email}
                onClick={() => {
                  setEmail(d.email);
                  setPassword("demo1234");
                }}
                className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-left text-xs transition hover:border-lime-400/40 hover:bg-zinc-900"
              >
                <span className="block font-medium text-zinc-200">{d.role}</span>
                <span className="block truncate text-zinc-500">{d.email}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
