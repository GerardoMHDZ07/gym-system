import { FormEvent, useEffect, useState } from "react";
import { api, ApiError, Exercise } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Alert, EmptyState, Modal, PageHeader, Spinner } from "../components/ui";

interface FormState {
  name: string;
  muscle_group: string;
  description: string;
  video_url: string;
}

export default function Exercises() {
  const { user } = useAuth();
  const isStaff = user?.role === "admin" || user?.role === "recepcion";
  const isAdmin = user?.role === "admin";

  const [exercises, setExercises] = useState<Exercise[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<null | { editing: Exercise | null }>(null);
  const [form, setForm] = useState<FormState>({ name: "", muscle_group: "", description: "", video_url: "" });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = () => api<Exercise[]>("/exercises").then(setExercises).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  if (error) return <Alert kind="error">{error}</Alert>;
  if (!exercises) return <Spinner />;

  const filtered = exercises.filter((e) => e.name.toLowerCase().includes(query.toLowerCase()));

  function openCreate() {
    setForm({ name: "", muscle_group: "", description: "", video_url: "" });
    setFormError(null);
    setModal({ editing: null });
  }
  function openEdit(e: Exercise) {
    setForm({ name: e.name, muscle_group: e.muscle_group ?? "", description: e.description ?? "", video_url: e.video_url ?? "" });
    setFormError(null);
    setModal({ editing: e });
  }

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    setFormError(null);
    setBusy(true);
    try {
      const body = {
        name: form.name,
        muscle_group: form.muscle_group || null,
        description: form.description || null,
        video_url: form.video_url || null,
      };
      if (modal?.editing) {
        await api(`/exercises/${modal.editing.id}`, { method: "PUT", body });
      } else {
        await api("/exercises", { method: "POST", body });
      }
      setModal(null);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Error al guardar");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(e: Exercise) {
    if (!confirm(`¿Eliminar "${e.name}" del catálogo?`)) return;
    try {
      await api(`/exercises/${e.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error al eliminar");
    }
  }

  return (
    <div>
      <PageHeader
        title="Ejercicios"
        subtitle="Catálogo compartido por las rutinas"
        action={isStaff ? <button className="btn-primary" onClick={openCreate}>+ Nuevo ejercicio</button> : undefined}
      />

      <input className="input mb-4 max-w-sm" placeholder="Buscar ejercicio..." value={query} onChange={(e) => setQuery(e.target.value)} />

      {filtered.length === 0 ? (
        <EmptyState title="Sin resultados" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((e) => (
            <div key={e.id} className="card p-5">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-zinc-100">{e.name}</h3>
                {isStaff && (
                  <div className="flex gap-2 text-xs">
                    <button className="text-lime-300 hover:text-lime-200" onClick={() => openEdit(e)}>Editar</button>
                    {isAdmin && <button className="text-red-400 hover:text-red-300" onClick={() => onDelete(e)}>Borrar</button>}
                  </div>
                )}
              </div>
              {e.muscle_group && (
                <p className="mt-1 inline-block rounded-full border border-zinc-700 px-2 py-0.5 text-xs capitalize text-zinc-400">{e.muscle_group}</p>
              )}
              {e.description && <p className="mt-2 text-sm text-zinc-500">{e.description}</p>}
              {e.video_url && (
                <a className="mt-2 inline-block text-xs text-lime-300 hover:text-lime-200" href={e.video_url} target="_blank" rel="noreferrer">Ver video →</a>
              )}
            </div>
          ))}
        </div>
      )}

      {modal && (
        <Modal title={modal.editing ? `Editar ${modal.editing.name}` : "Nuevo ejercicio"} onClose={() => setModal(null)}>
          <form onSubmit={onSubmit} className="space-y-4">
            {formError && <Alert kind="error">{formError}</Alert>}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-300">Nombre</label>
              <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-300">Grupo muscular</label>
              <input className="input" value={form.muscle_group} onChange={(e) => setForm({ ...form, muscle_group: e.target.value })} placeholder="p. ej. piernas, pecho, espalda" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-300">Descripción</label>
              <textarea className="input" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-300">URL de video</label>
              <input className="input" type="url" value={form.video_url} onChange={(e) => setForm({ ...form, video_url: e.target.value })} placeholder="https://..." />
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
