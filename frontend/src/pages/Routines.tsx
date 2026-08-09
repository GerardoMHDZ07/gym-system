import { FormEvent, useEffect, useState } from "react";
import { api, ApiError, ApiUser, Exercise, Routine } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Alert, EmptyState, Modal, PageHeader, Spinner } from "../components/ui";

interface ExRow {
  exercise_id: string;
  sets: string;
  reps: string;
  rest_seconds: string;
}

interface FormState {
  name: string;
  assigned_to: string;
  notes: string;
  exercises: ExRow[];
}

export default function Routines() {
  const { user } = useAuth();
  const canEdit = user?.role === "admin" || user?.role === "recepcion" || user?.role === "entrenador";
  const isMember = user?.role === "miembro";

  const [routines, setRoutines] = useState<Routine[] | null>(null);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [modal, setModal] = useState<null | { editing: Routine | null }>(null);
  const [form, setForm] = useState<FormState>({ name: "", assigned_to: "", notes: "", exercises: [] });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  // Detalles cacheados: el listado no trae ejercicios, se piden al expandir
  const [details, setDetails] = useState<Record<number, Routine>>({});

  const load = async () => {
    setRoutines(await api<Routine[]>("/routines"));
    if (canEdit) {
      setExercises(await api<Exercise[]>("/exercises"));
      setUsers(await api<ApiUser[]>("/users"));
    }
  };

  useEffect(() => {
    load().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) return <Alert kind="error">{error}</Alert>;
  if (!routines) return <Spinner />;

  const userById = new Map(users.map((u) => [u.id, u]));
  const exerciseById = new Map(exercises.map((e) => [e.id, e]));
  const members = users.filter((u) => u.role === "miembro");

  function openCreate() {
    setForm({ name: "", assigned_to: "", notes: "", exercises: [{ exercise_id: "", sets: "3", reps: "10", rest_seconds: "" }] });
    setFormError(null);
    setModal({ editing: null });
  }
  function openEdit(r: Routine) {
    setForm({
      name: r.name,
      assigned_to: String(r.assigned_to),
      notes: r.notes ?? "",
      exercises: (r.exercises ?? []).map((ex) => ({
        exercise_id: String(ex.exercise_id),
        sets: String(ex.sets),
        reps: String(ex.reps),
        rest_seconds: ex.rest_seconds != null ? String(ex.rest_seconds) : "",
      })),
    });
    setFormError(null);
    setModal({ editing: r });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setBusy(true);
    try {
      const body = {
        name: form.name,
        assigned_to: Number(form.assigned_to),
        notes: form.notes || null,
        exercises: form.exercises
          .filter((ex) => ex.exercise_id)
          .map((ex) => ({
            exercise_id: Number(ex.exercise_id),
            sets: Number(ex.sets),
            reps: Number(ex.reps),
            ...(ex.rest_seconds ? { rest_seconds: Number(ex.rest_seconds) } : {}),
          })),
      };
      if (modal?.editing) {
        await api(`/routines/${modal.editing.id}`, { method: "PUT", body });
      } else {
        await api("/routines", { method: "POST", body });
      }
      setModal(null);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Error al guardar la rutina");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(r: Routine) {
    if (!confirm(`¿Eliminar la rutina "${r.name}"?`)) return;
    try {
      await api(`/routines/${r.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error al eliminar");
    }
  }

  async function toggleExpand(id: number) {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    if (!details[id]) {
      try {
        const detail = await api<Routine>(`/routines/${id}`);
        setDetails((prev) => ({ ...prev, [id]: detail }));
      } catch {
        // se muestra sin ejercicios
      }
    }
  }

  const setRow = (i: number, patch: Partial<ExRow>) => {
    setForm({ ...form, exercises: form.exercises.map((ex, idx) => (idx === i ? { ...ex, ...patch } : ex)) });
  };

  return (
    <div>
      <PageHeader
        title="Rutinas"
        subtitle={isMember ? "Las rutinas que te asignó tu entrenador" : "Rutinas de entrenamiento"}
        action={canEdit ? <button className="btn-primary" onClick={openCreate}>+ Nueva rutina</button> : undefined}
      />

      {routines.length === 0 ? (
        <EmptyState title={isMember ? "Todavía no tenés rutinas asignadas" : "Sin rutinas"} hint={isMember ? "Consultá con tu entrenador" : undefined} />
      ) : (
        <div className="space-y-3">
          {routines.map((r) => {
            const count = r.exercises?.length;
            return (
              <div key={r.id} className="card">
                <button className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left" onClick={() => toggleExpand(r.id)}>
                  <div>
                    <p className="font-semibold text-zinc-100">{r.name}</p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {canEdit
                        ? `Asignada a ${userById.get(r.assigned_to)?.name ?? `#${r.assigned_to}`} · ${details[r.id]?.exercises?.length ?? count ?? 0} ejercicios`
                        : `${details[r.id]?.exercises?.length ?? count ?? 0} ejercicios`}
                      {r.notes && <span className="text-zinc-600"> · {r.notes}</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {canEdit && (
                      <>
                        <button className="text-sm text-lime-300 hover:text-lime-200" onClick={(e) => { e.stopPropagation(); openEdit(r); }}>Editar</button>
                        {user?.role === "admin" && (
                          <button className="text-sm text-red-400 hover:text-red-300" onClick={(e) => { e.stopPropagation(); onDelete(r); }}>Borrar</button>
                        )}
                      </>
                    )}
                    <span className={`text-zinc-500 transition ${expanded === r.id ? "rotate-180" : ""}`}>▾</span>
                  </div>
                </button>

                {expanded === r.id && (
                  <div className="border-t border-zinc-800 px-5 py-4">
                    {!details[r.id] ? (
                      <p className="text-sm text-zinc-500">Cargando ejercicios...</p>
                    ) : details[r.id].exercises?.length === 0 ? (
                      <p className="text-sm text-zinc-500">Rutina sin ejercicios todavía.</p>
                    ) : (
                      <ol className="space-y-2">
                        {details[r.id].exercises!.map((ex, i) => (
                          <li key={ex.id} className="flex items-center gap-3 text-sm">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs text-zinc-400">{i + 1}</span>
                            <span className="font-medium text-zinc-200">{ex.exercise_name}</span>
                            <span className="text-zinc-500">{ex.sets} × {ex.reps}</span>
                            {ex.rest_seconds != null && <span className="text-xs text-zinc-600">{ex.rest_seconds}s descanso</span>}
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {modal && (
        <Modal title={modal.editing ? `Editar ${modal.editing.name}` : "Nueva rutina"} onClose={() => setModal(null)} wide>
          <form onSubmit={onSubmit} className="space-y-4">
            {formError && <Alert kind="error">{formError}</Alert>}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-300">Nombre</label>
                <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-300">Asignada a (miembro)</label>
                <select className="input" required value={form.assigned_to} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}>
                  <option value="" disabled>Seleccionar miembro...</option>
                  {members.map((u) => (
                    <option key={u.id} value={u.id}>{u.name} — {u.email}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-300">Notas</label>
              <textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium text-zinc-300">Ejercicios</label>
                <button type="button" className="text-sm text-lime-300 hover:text-lime-200" onClick={() => setForm({ ...form, exercises: [...form.exercises, { exercise_id: "", sets: "3", reps: "10", rest_seconds: "" }] })}>
                  + Agregar ejercicio
                </button>
              </div>
              <div className="space-y-2">
                {form.exercises.map((ex, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 p-2">
                    <select className="input min-w-40 flex-1" required value={ex.exercise_id} onChange={(e) => setRow(i, { exercise_id: e.target.value })}>
                      <option value="" disabled>Ejercicio...</option>
                      {exercises.map((e) => (
                        <option key={e.id} value={e.id}>{e.name}</option>
                      ))}
                    </select>
                    <input className="input w-16" type="number" min={1} placeholder="Series" value={ex.sets} onChange={(e) => setRow(i, { sets: e.target.value })} />
                    <span className="text-xs text-zinc-600">×</span>
                    <input className="input w-16" type="number" min={1} placeholder="Reps" value={ex.reps} onChange={(e) => setRow(i, { reps: e.target.value })} />
                    <input className="input w-24" type="number" min={0} placeholder="Descanso s" value={ex.rest_seconds} onChange={(e) => setRow(i, { rest_seconds: e.target.value })} />
                    <button type="button" className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-800 hover:text-red-300" onClick={() => setForm({ ...form, exercises: form.exercises.filter((_, idx) => idx !== i) })} aria-label="Quitar ejercicio">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
                    </button>
                  </div>
                ))}
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
