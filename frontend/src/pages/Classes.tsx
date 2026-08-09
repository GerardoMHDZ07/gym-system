import { FormEvent, useEffect, useState } from "react";
import { api, ApiError, ApiUser, GymClass } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Alert, EmptyState, Modal, PageHeader, Spinner, fmtDateTime } from "../components/ui";

interface FormState {
  name: string;
  trainer_id: string;
  schedule_start: string;
  schedule_end: string;
  capacity: string;
}

export default function Classes() {
  const { user } = useAuth();
  const isStaff = user?.role === "admin" || user?.role === "recepcion";
  const isAdmin = user?.role === "admin";

  const [classes, setClasses] = useState<GymClass[] | null>(null);
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<null | { editing: GymClass | null }>(null);
  const [form, setForm] = useState<FormState>({ name: "", trainer_id: "", schedule_start: "", schedule_end: "", capacity: "" });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = () =>
    Promise.all([
      api<GymClass[]>("/classes"),
      ...(isStaff ? [api<ApiUser[]>("/users")] : [Promise.resolve([] as ApiUser[])]),
    ]).then(([c, u]) => {
      setClasses(c);
      setUsers(u);
    });

  useEffect(() => {
    load().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) return <Alert kind="error">{error}</Alert>;
  if (!classes) return <Spinner />;

  const trainerById = new Map(users.filter((u) => u.role === "entrenador").map((u) => [u.id, u]));
  const upcoming = classes.filter((c) => new Date(c.schedule_start.replace(" ", "T") + "Z") > new Date());
  const past = classes.filter((c) => new Date(c.schedule_start.replace(" ", "T") + "Z") <= new Date());

  function openCreate() {
    setForm({ name: "", trainer_id: "", schedule_start: "", schedule_end: "", capacity: "" });
    setFormError(null);
    setModal({ editing: null });
  }
  function openEdit(c: GymClass) {
    setForm({
      name: c.name,
      trainer_id: String(c.trainer_id),
      schedule_start: toLocalInput(c.schedule_start),
      schedule_end: toLocalInput(c.schedule_end),
      capacity: String(c.capacity),
    });
    setFormError(null);
    setModal({ editing: c });
  }

  // El backend espera ISO 8601 con zona; el input datetime-local entrega hora local
  function toIso(local: string): string {
    return local ? new Date(local).toISOString() : "";
  }
  function toLocalInput(utcText: string): string {
    const d = new Date(utcText.replace(" ", "T") + "Z");
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setBusy(true);
    try {
      const body = {
        name: form.name,
        trainer_id: Number(form.trainer_id),
        schedule_start: toIso(form.schedule_start),
        schedule_end: toIso(form.schedule_end),
        capacity: Number(form.capacity),
      };
      if (modal?.editing) {
        await api(`/classes/${modal.editing.id}`, { method: "PUT", body });
      } else {
        await api("/classes", { method: "POST", body });
      }
      setModal(null);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Error al guardar la clase");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(c: GymClass) {
    if (!confirm(`¿Eliminar la clase "${c.name}"?`)) return;
    try {
      await api(`/classes/${c.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error al eliminar");
    }
  }

  const Card = ({ c }: { c: GymClass }) => (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-zinc-100">{c.name}</h3>
        {isStaff && (
          <div className="flex gap-2 text-xs">
            <button className="text-lime-300 hover:text-lime-200" onClick={() => openEdit(c)}>Editar</button>
            {isAdmin && <button className="text-red-400 hover:text-red-300" onClick={() => onDelete(c)}>Borrar</button>}
          </div>
        )}
      </div>
      <p className="mt-1 text-sm text-zinc-500">
        {isStaff && trainerById.get(c.trainer_id) ? `Entrenador: ${trainerById.get(c.trainer_id)!.name} · ` : ""}
        {fmtDateTime(c.schedule_start)} — {fmtDateTime(c.schedule_end)}
      </p>
      <p className="mt-2 text-xs uppercase tracking-wider text-zinc-600">Capacidad: {c.capacity}</p>
    </div>
  );

  return (
    <div>
      <PageHeader
        title="Clases"
        subtitle="Catálogo de clases del gimnasio"
        action={isStaff ? <button className="btn-primary" onClick={openCreate}>+ Nueva clase</button> : undefined}
      />

      {upcoming.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">Próximas</h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {upcoming.map((c) => <Card key={c.id} c={c} />)}
          </div>
        </div>
      )}

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">Anteriores</h2>
      {past.length === 0 ? (
        <EmptyState title="Sin clases anteriores" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {past.map((c) => <Card key={c.id} c={c} />)}
        </div>
      )}

      {modal && (
        <Modal title={modal.editing ? `Editar ${modal.editing.name}` : "Nueva clase"} onClose={() => setModal(null)} wide>
          <form onSubmit={onSubmit} className="space-y-4">
            {formError && <Alert kind="error">{formError}</Alert>}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-300">Nombre</label>
                <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-300">Entrenador</label>
                <select className="input" required value={form.trainer_id} onChange={(e) => setForm({ ...form, trainer_id: e.target.value })}>
                  <option value="" disabled>Seleccionar...</option>
                  {[...trainerById.values()].map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-300">Inicio</label>
                <input className="input" type="datetime-local" required value={form.schedule_start} onChange={(e) => setForm({ ...form, schedule_start: e.target.value })} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-300">Fin</label>
                <input className="input" type="datetime-local" required value={form.schedule_end} onChange={(e) => setForm({ ...form, schedule_end: e.target.value })} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-300">Capacidad</label>
                <input className="input" type="number" min={1} required value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
              </div>
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
