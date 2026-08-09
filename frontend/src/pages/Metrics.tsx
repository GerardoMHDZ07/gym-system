import { FormEvent, useEffect, useState } from "react";
import { api, ApiError, ApiUser, BodyMetric } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Alert, EmptyState, Modal, PageHeader, Spinner } from "../components/ui";

interface FormState {
  user_id: string;
  date: string;
  weight_kg: string;
  body_fat_pct: string;
  notes: string;
}

const today = () => new Date().toISOString().slice(0, 10);

export default function Metrics() {
  const { user } = useAuth();
  const isStaff = user?.role === "admin" || user?.role === "recepcion" || user?.role === "entrenador";

  const [metrics, setMetrics] = useState<BodyMetric[] | null>(null);
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [modal, setModal] = useState<null | { editing: BodyMetric | null }>(null);
  const [form, setForm] = useState<FormState>({ user_id: "", date: today(), weight_kg: "", body_fat_pct: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = () =>
    Promise.all([
      api<BodyMetric[]>("/metrics"),
      ...(isStaff ? [api<ApiUser[]>("/users")] : [Promise.resolve([] as ApiUser[])]),
    ]).then(([m, u]) => {
      setMetrics(m);
      setUsers(u);
    });

  useEffect(() => {
    load().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) return <Alert kind="error">{error}</Alert>;
  if (!metrics) return <Spinner />;

  const userById = new Map(users.map((u) => [u.id, u]));
  const members = users.filter((u) => u.role === "miembro");
  const rows = metrics.filter((m) => {
    const u = userById.get(m.user_id);
    return !filter || (u && (u.name.toLowerCase().includes(filter.toLowerCase()) || u.email.toLowerCase().includes(filter.toLowerCase())));
  });

  function openCreate() {
    setForm({ user_id: isStaff ? "" : String(user!.id), date: today(), weight_kg: "", body_fat_pct: "", notes: "" });
    setFormError(null);
    setModal({ editing: null });
  }
  function openEdit(m: BodyMetric) {
    setForm({
      user_id: String(m.user_id),
      date: m.date,
      weight_kg: m.weight_kg != null ? String(m.weight_kg) : "",
      body_fat_pct: m.body_fat_pct != null ? String(m.body_fat_pct) : "",
      notes: m.notes ?? "",
    });
    setFormError(null);
    setModal({ editing: m });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setBusy(true);
    try {
      const payload = {
        weight_kg: form.weight_kg ? Number(form.weight_kg) : undefined,
        body_fat_pct: form.body_fat_pct ? Number(form.body_fat_pct) : undefined,
        notes: form.notes || null,
      };
      if (modal?.editing) {
        await api(`/metrics/${modal.editing.id}`, { method: "PUT", body: payload });
      } else {
        const body = isStaff
          ? { ...payload, user_id: Number(form.user_id), date: form.date || undefined }
          : { ...payload, date: form.date || undefined };
        await api("/metrics", { method: "POST", body });
      }
      setModal(null);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Error al guardar");
    } finally {
      setBusy(false);
    }
  }

  const first = rows[0];
  const last = rows[rows.length - 1];

  return (
    <div>
      <PageHeader
        title="Métricas corporales"
        subtitle={isStaff ? "Progreso físico de los miembros" : "Tu progreso físico"}
        action={<button className="btn-primary" onClick={openCreate}>+ Registrar medición</button>}
      />

      {rows.length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="card p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Primera medición</p>
            <p className="mt-1 text-lg font-bold tabular-nums text-zinc-100">
              {first.weight_kg != null ? `${first.weight_kg} kg` : "—"}
              <span className="ml-2 text-xs font-normal text-zinc-500">{first.date}</span>
            </p>
          </div>
          <div className="card p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Última medición</p>
            <p className="mt-1 text-lg font-bold tabular-nums text-zinc-100">
              {last.weight_kg != null ? `${last.weight_kg} kg` : "—"}
              <span className="ml-2 text-xs font-normal text-zinc-500">{last.date}</span>
            </p>
          </div>
          <div className="card p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Cambio de peso</p>
            <p className="mt-1 text-lg font-bold tabular-nums text-lime-300">
              {first.weight_kg != null && last.weight_kg != null
                ? `${(last.weight_kg - first.weight_kg).toFixed(1)} kg`
                : "—"}
            </p>
          </div>
          <div className="card p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Body fat actual</p>
            <p className="mt-1 text-lg font-bold tabular-nums text-zinc-100">{last.body_fat_pct != null ? `${last.body_fat_pct}%` : "—"}</p>
          </div>
        </div>
      )}

      {isStaff && (
        <input className="input mb-4 max-w-sm" placeholder="Filtrar por miembro..." value={filter} onChange={(e) => setFilter(e.target.value)} />
      )}

      {rows.length === 0 ? (
        <EmptyState title="Sin mediciones" hint="Registrá tu primera medición" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-zinc-800">
              <tr>
                <th className="th">Fecha</th>
                {isStaff && <th className="th">Miembro</th>}
                <th className="th">Peso (kg)</th>
                <th className="th">Body fat (%)</th>
                <th className="th">Notas</th>
                <th className="th text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {rows.map((m) => (
                <tr key={m.id} className="transition hover:bg-zinc-800/30">
                  <td className="td text-zinc-500">{m.date}</td>
                  {isStaff && <td className="td">{userById.get(m.user_id)?.name ?? `#${m.user_id}`}</td>}
                  <td className="td font-medium tabular-nums text-zinc-100">{m.weight_kg ?? "—"}</td>
                  <td className="td tabular-nums">{m.body_fat_pct ?? "—"}</td>
                  <td className="td text-zinc-500">{m.notes ?? ""}</td>
                  <td className="td text-right">
                    <button className="text-sm text-lime-300 hover:text-lime-200" onClick={() => openEdit(m)}>Editar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <Modal title={modal.editing ? "Editar medición" : "Registrar medición"} onClose={() => setModal(null)}>
          <form onSubmit={onSubmit} className="space-y-4">
            {formError && <Alert kind="error">{formError}</Alert>}
            {isStaff && !modal.editing && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-300">Miembro</label>
                <select className="input" required value={form.user_id} onChange={(e) => setForm({ ...form, user_id: e.target.value })}>
                  <option value="" disabled>Seleccionar miembro...</option>
                  {members.map((u) => (
                    <option key={u.id} value={u.id}>{u.name} — {u.email}</option>
                  ))}
                </select>
              </div>
            )}
            {!modal.editing && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-300">Fecha</label>
                <input className="input" type="date" max={today()} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-300">Peso (kg)</label>
                <input className="input" type="number" min={0} step="0.01" value={form.weight_kg} onChange={(e) => setForm({ ...form, weight_kg: e.target.value })} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-300">Body fat (%)</label>
                <input className="input" type="number" min={0} max={99.99} step="0.01" value={form.body_fat_pct} onChange={(e) => setForm({ ...form, body_fat_pct: e.target.value })} />
              </div>
            </div>
            <p className="text-xs text-zinc-600">Al menos un valor (peso o body fat) es obligatorio.</p>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-300">Notas</label>
              <input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={() => setModal(null)}>Cancelar</button>
              <button className="btn-primary" disabled={busy}>{busy ? "Guardando..." : "Guardar"}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
