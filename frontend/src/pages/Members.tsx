import { FormEvent, useEffect, useState } from "react";
import { api, ApiError, ApiUser, ROLES, roleLabel } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Alert, Badge, EmptyState, Modal, PageHeader, Spinner } from "../components/ui";

interface FormState {
  name: string;
  email: string;
  password: string;
  role: ApiUser["role"];
}

const EMPTY: FormState = { name: "", email: "", password: "", role: "miembro" };

export default function Members() {
  const { user } = useAuth();
  const [users, setUsers] = useState<ApiUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [modal, setModal] = useState<null | { editing: ApiUser | null }>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");

  const isAdmin = user?.role === "admin";
  const load = () => api<ApiUser[]>("/users").then(setUsers).catch((e) => setError(e.message));

  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setForm(EMPTY);
    setFormError(null);
    setModal({ editing: null });
  }
  function openEdit(u: ApiUser) {
    setForm({ name: u.name, email: u.email, password: "", role: u.role });
    setFormError(null);
    setModal({ editing: u });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setBusy(true);
    try {
      if (modal?.editing) {
        const body: Record<string, unknown> = { name: form.name, email: form.email, role: form.role };
        if (form.password) body.password = form.password;
        await api(`/users/${modal.editing.id}`, { method: "PUT", body });
      } else {
        await api("/users", { method: "POST", body: form });
      }
      setModal(null);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Error al guardar");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(u: ApiUser) {
    if (!confirm(`¿Eliminar a ${u.name}? Se borran sus membresías, check-ins, reservas y métricas.`)) return;
    try {
      await api(`/users/${u.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error al eliminar");
    }
  }

  const filtered = (users ?? []).filter(
    (u) => u.name.toLowerCase().includes(query.toLowerCase()) || u.email.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div>
      <PageHeader
        title="Miembros"
        subtitle="Usuarios del sistema y sus roles"
        action={<button className="btn-primary" onClick={openCreate}>+ Nuevo usuario</button>}
      />

      {error && <div className="mb-4"><Alert kind="error">{error}</Alert></div>}

      <input className="input mb-4 max-w-sm" placeholder="Buscar por nombre o email..." value={query} onChange={(e) => setQuery(e.target.value)} />

      {!users ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <EmptyState title="Sin resultados" hint="Probá con otra búsqueda" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-zinc-800">
              <tr>
                <th className="th">Nombre</th>
                <th className="th">Email</th>
                <th className="th">Rol</th>
                <th className="th">Alta</th>
                <th className="th text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {filtered.map((u) => (
                <tr key={u.id} className="transition hover:bg-zinc-800/30">
                  <td className="td font-medium text-zinc-100">{u.name}</td>
                  <td className="td">{u.email}</td>
                  <td className="td"><Badge value={u.role} /></td>
                  <td className="td text-zinc-500">{u.created_at.slice(0, 10)}</td>
                  <td className="td text-right">
                    <button className="mr-2 text-sm text-lime-300 hover:text-lime-200" onClick={() => openEdit(u)}>Editar</button>
                    {isAdmin && (
                      <button className="text-sm text-red-400 hover:text-red-300" onClick={() => onDelete(u)}>Eliminar</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <Modal title={modal.editing ? `Editar a ${modal.editing.name}` : "Nuevo usuario"} onClose={() => setModal(null)}>
          <form onSubmit={onSubmit} className="space-y-4">
            {formError && <Alert kind="error">{formError}</Alert>}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-300">Nombre</label>
              <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-300">Email</label>
              <input className="input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-300">
                Contraseña {modal.editing && <span className="text-zinc-500">(dejá vacía para no cambiarla)</span>}
              </label>
              <input className="input" type="password" minLength={8} required={!modal.editing && isAdmin} disabled={!isAdmin} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              {!isAdmin && <p className="mt-1 text-xs text-zinc-500">Solo admin puede asignar contraseñas.</p>}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-300">Rol</label>
              <select className="input" value={form.role} disabled={!isAdmin} onChange={(e) => setForm({ ...form, role: e.target.value as ApiUser["role"] })}>
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
              {!isAdmin && <p className="mt-1 text-xs text-zinc-500">Solo admin puede cambiar roles.</p>}
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
