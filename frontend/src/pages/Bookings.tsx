import { FormEvent, useEffect, useState } from "react";
import { api, ApiError, ApiUser, Booking, GymClass } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Alert, Badge, EmptyState, Modal, PageHeader, Spinner, fmtDateTime } from "../components/ui";

export default function Bookings() {
  const { user } = useAuth();
  const isStaff = user?.role === "admin" || user?.role === "recepcion";

  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [classes, setClasses] = useState<GymClass[]>([]);
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [bookModal, setBookModal] = useState(false);
  const [form, setForm] = useState({ class_id: "", user_id: "" });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = () =>
    Promise.all([
      api<Booking[]>("/bookings"),
      api<GymClass[]>("/classes"),
      ...(isStaff ? [api<ApiUser[]>("/users")] : [Promise.resolve([] as ApiUser[])]),
    ]).then(([b, c, u]) => {
      setBookings(b);
      setClasses(c);
      setUsers(u);
    });

  useEffect(() => {
    load().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) return <Alert kind="error">{error}</Alert>;
  if (!bookings) return <Spinner />;

  const userById = new Map(users.map((u) => [u.id, u]));
  const classById = new Map(classes.map((c) => [c.id, c]));
  const bookable = classes.filter((c) => new Date(c.schedule_start.replace(" ", "T") + "Z") > new Date());

  async function onBook(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setBusy(true);
    try {
      await api("/bookings", {
        method: "POST",
        body: isStaff ? { class_id: Number(form.class_id), user_id: Number(form.user_id) } : { class_id: Number(form.class_id) },
      });
      setNotice("Reserva confirmada.");
      setBookModal(false);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Error al reservar");
    } finally {
      setBusy(false);
    }
  }

  async function onCancel(b: Booking) {
    try {
      await api(`/bookings/${b.id}`, { method: "PUT", body: { status: "cancelada" } });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error al cancelar la reserva");
    }
  }

  return (
    <div>
      <PageHeader
        title="Reservas"
        subtitle={isStaff ? "Gestioná reservas de clases en nombre de los miembros" : "Reservá tu lugar en las clases"}
        action={<button className="btn-primary" onClick={() => { setForm({ class_id: "", user_id: "" }); setFormError(null); setBookModal(true); }}>+ Reservar clase</button>}
      />

      {notice && <div className="mb-4"><Alert kind="success">{notice}</Alert></div>}
      {error && <div className="mb-4"><Alert kind="error">{error}</Alert></div>}

      {bookings.length === 0 ? (
        <EmptyState title="Sin reservas" hint="Reservá tu primera clase" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-zinc-800">
              <tr>
                <th className="th">Clase</th>
                {isStaff && <th className="th">Miembro</th>}
                <th className="th">Horario</th>
                <th className="th">Estado</th>
                <th className="th text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {bookings.map((b) => (
                <tr key={b.id} className="transition hover:bg-zinc-800/30">
                  <td className="td font-medium text-zinc-100">{b.class_name ?? classById.get(b.class_id)?.name ?? `#${b.class_id}`}</td>
                  {isStaff && <td className="td">{userById.get(b.user_id)?.name ?? `#${b.user_id}`}</td>}
                  <td className="td text-zinc-500">
                    {classById.get(b.class_id) ? fmtDateTime(classById.get(b.class_id)!.schedule_start) : "—"}
                  </td>
                  <td className="td"><Badge value={b.status} /></td>
                  <td className="td text-right">
                    {b.status === "reservada" && (
                      <button className="text-sm text-amber-300 hover:text-amber-200" onClick={() => onCancel(b)}>Cancelar</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {bookModal && (
        <Modal title="Reservar clase" onClose={() => setBookModal(false)}>
          <form onSubmit={onBook} className="space-y-4">
            {formError && <Alert kind="error">{formError}</Alert>}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-300">Clase</label>
              <select className="input" required value={form.class_id} onChange={(e) => setForm({ ...form, class_id: e.target.value })}>
                <option value="" disabled>Seleccionar clase...</option>
                {bookable.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} — {fmtDateTime(c.schedule_start)}</option>
                ))}
              </select>
            </div>
            {isStaff && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-300">Miembro</label>
                <select className="input" required value={form.user_id} onChange={(e) => setForm({ ...form, user_id: e.target.value })}>
                  <option value="" disabled>Seleccionar miembro...</option>
                  {users.filter((u) => u.role === "miembro").map((u) => (
                    <option key={u.id} value={u.id}>{u.name} — {u.email}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={() => setBookModal(false)}>Cancelar</button>
              <button className="btn-primary" disabled={busy}>{busy ? "Reservando..." : "Reservar"}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
