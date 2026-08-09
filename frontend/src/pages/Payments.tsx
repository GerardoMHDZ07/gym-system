import { FormEvent, useEffect, useState } from "react";
import { api, ApiError, ApiUser, Membership, Payment } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Alert, Badge, EmptyState, Modal, PageHeader, Spinner, fmtDateTime } from "../components/ui";

export default function Payments() {
  const { user } = useAuth();
  const isStaff = user?.role === "admin" || user?.role === "recepcion";

  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ membership_id: "", amount: "", method: "efectivo" });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = async () => {
    setPayments(await api<Payment[]>("/payments"));
    if (isStaff) {
      setMemberships(await api<Membership[]>("/memberships"));
      setUsers(await api<ApiUser[]>("/users"));
    }
  };

  useEffect(() => {
    load().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) return <Alert kind="error">{error}</Alert>;
  if (!payments) return <Spinner />;

  const userById = new Map(users.map((u) => [u.id, u]));
  const rows = isStaff && filter
    ? payments.filter((p) => {
        const u = userById.get(p.user_id!);
        return u && (u.name.toLowerCase().includes(filter.toLowerCase()) || u.email.toLowerCase().includes(filter.toLowerCase()));
      })
    : payments;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setBusy(true);
    try {
      await api("/payments", {
        method: "POST",
        body: { membership_id: Number(form.membership_id), amount: Number(form.amount), method: form.method },
      });
      setModal(false);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Error al registrar el pago");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Pagos"
        subtitle={isStaff ? "Ledger financiero — un pago registrado es inmutable" : "Tu historial de pagos"}
        action={isStaff ? <button className="btn-primary" onClick={() => { setForm({ membership_id: "", amount: "", method: "efectivo" }); setFormError(null); setModal(true); }}>+ Registrar pago</button> : undefined}
      />

      {isStaff && (
        <input className="input mb-4 max-w-sm" placeholder="Filtrar por miembro..." value={filter} onChange={(e) => setFilter(e.target.value)} />
      )}

      {rows.length === 0 ? (
        <EmptyState title="Sin pagos" hint="Los pagos registrados aparecen acá" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-zinc-800">
              <tr>
                <th className="th">Fecha</th>
                {isStaff && <th className="th">Miembro</th>}
                <th className="th">Membresía</th>
                <th className="th">Monto</th>
                <th className="th">Método</th>
                <th className="th">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {rows.map((p) => (
                <tr key={p.id} className="transition hover:bg-zinc-800/30">
                  <td className="td text-zinc-500">{fmtDateTime(p.payment_date)}</td>
                  {isStaff && <td className="td">{userById.get(p.user_id!)?.name ?? `#${p.user_id}`}</td>}
                  <td className="td">#{p.membership_id}</td>
                  <td className="td font-medium tabular-nums text-zinc-100">${Number(p.amount).toLocaleString("es-AR", { minimumFractionDigits: 2 })}</td>
                  <td className="td capitalize">{p.method}</td>
                  <td className="td"><Badge value={p.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <Modal title="Registrar pago" onClose={() => setModal(false)}>
          <form onSubmit={onSubmit} className="space-y-4">
            {formError && <Alert kind="error">{formError}</Alert>}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-300">Membresía</label>
              <select className="input" required value={form.membership_id} onChange={(e) => setForm({ ...form, membership_id: e.target.value })}>
                <option value="" disabled>Seleccionar membresía...</option>
                {memberships.filter((m) => m.status === "activa").map((m) => (
                  <option key={m.id} value={m.id}>
                    #{m.id} — {userById.get(m.user_id)?.name ?? `user ${m.user_id}`} (vence {m.end_date})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-300">Monto</label>
              <input className="input" type="number" min={0} step="0.01" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-300">Método</label>
              <select className="input" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                <option value="efectivo">Efectivo</option>
                <option value="tarjeta">Tarjeta</option>
                <option value="transferencia">Transferencia</option>
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={() => setModal(false)}>Cancelar</button>
              <button className="btn-primary" disabled={busy}>{busy ? "Registrando..." : "Registrar"}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
