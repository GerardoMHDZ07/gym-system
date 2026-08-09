import { FormEvent, useEffect, useState } from "react";
import { api, ApiError, ApiUser, Checkin } from "../api/client";
import { Alert, EmptyState, PageHeader, Spinner, fmtDateTime } from "../components/ui";

export default function Checkins() {
  const [checkins, setCheckins] = useState<Checkin[] | null>(null);
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [userId, setUserId] = useState("");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () =>
    Promise.all([api<Checkin[]>("/checkins"), api<ApiUser[]>("/users")]).then(([c, u]) => {
      setCheckins(c);
      setUsers(u);
    });

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function onRegister(e: FormEvent) {
    e.preventDefault();
    setNotice(null);
    setError(null);
    setBusy(true);
    try {
      await api<Checkin>("/checkins", { method: "POST", body: { user_id: Number(userId) } });
      const u = users.find((x) => x.id === Number(userId));
      setNotice(`Check-in registrado para ${u?.name ?? `#${userId}`}.`);
      setUserId("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error al registrar check-in");
    } finally {
      setBusy(false);
    }
  }

  const userById = new Map(users.map((u) => [u.id, u]));
  const rows = (checkins ?? []).filter((c) => {
    const u = userById.get(c.user_id);
    return !filter || (u && (u.name.toLowerCase().includes(filter.toLowerCase()) || u.email.toLowerCase().includes(filter.toLowerCase())));
  });

  return (
    <div>
      <PageHeader title="Check-ins" subtitle="Registro de entrada diario — máx. 2 por día, membresía activa requerida" />

      <form onSubmit={onRegister} className="card mb-6 flex flex-wrap items-end gap-3 p-5">
        <div className="min-w-64 flex-1">
          <label className="mb-1.5 block text-sm font-medium text-zinc-300">Miembro</label>
          <select className="input" required value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="" disabled>Seleccionar miembro...</option>
            {users.filter((u) => u.role === "miembro").map((u) => (
              <option key={u.id} value={u.id}>{u.name} — {u.email}</option>
            ))}
          </select>
        </div>
        <button className="btn-primary" disabled={busy || !userId}>{busy ? "Registrando..." : "Registrar entrada"}</button>
      </form>

      {notice && <div className="mb-4"><Alert kind="success">{notice}</Alert></div>}
      {error && <div className="mb-4"><Alert kind="error">{error}</Alert></div>}

      <input className="input mb-4 max-w-sm" placeholder="Filtrar por miembro..." value={filter} onChange={(e) => setFilter(e.target.value)} />

      {!checkins ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState title="Sin check-ins" hint="Los registros de entrada aparecen acá" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-zinc-800">
              <tr>
                <th className="th">Fecha y hora</th>
                <th className="th">Miembro</th>
                <th className="th">Email</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {rows.map((c) => (
                <tr key={c.id} className="transition hover:bg-zinc-800/30">
                  <td className="td text-zinc-500">{fmtDateTime(c.checkin_time)}</td>
                  <td className="td font-medium text-zinc-100">{userById.get(c.user_id)?.name ?? `#${c.user_id}`}</td>
                  <td className="td">{userById.get(c.user_id)?.email}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
