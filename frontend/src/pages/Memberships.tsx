import { FormEvent, useEffect, useState } from "react";
import { api, ApiError, ApiUser, Membership, MembershipPlan, Payment } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Alert, Badge, EmptyState, Modal, PageHeader, Spinner, fmtDate } from "../components/ui";

export default function Memberships() {
  const { user } = useAuth();
  const isStaff = user?.role === "admin" || user?.role === "recepcion";
  const isAdmin = user?.role === "admin";

  const [memberships, setMemberships] = useState<Membership[] | null>(null);
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const [createModal, setCreateModal] = useState(false);
  const [payModal, setPayModal] = useState<Membership | null>(null);
  const [form, setForm] = useState({ user_id: "", plan_id: "" });
  const [payForm, setPayForm] = useState({ amount: "", method: "efectivo" });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = async () => {
    const [m, p] = await Promise.all([api<Membership[]>("/memberships"), api<MembershipPlan[]>("/plans")]);
    setMemberships(m);
    setPlans(p);
    if (isStaff) setUsers(await api<ApiUser[]>("/users"));
  };

  useEffect(() => {
    load().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) return <Alert kind="error">{error}</Alert>;
  if (!memberships) return <Spinner />;

  const userById = new Map(users.map((u) => [u.id, u]));
  const planById = new Map(plans.map((p) => [p.id, p]));

  const rows = memberships.filter((m) => {
    const u = userById.get(m.user_id);
    return !filter || (u && (u.name.toLowerCase().includes(filter.toLowerCase()) || u.email.toLowerCase().includes(filter.toLowerCase())));
  });

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setBusy(true);
    try {
      await api("/memberships", { method: "POST", body: { user_id: Number(form.user_id), plan_id: Number(form.plan_id) } });
      setCreateModal(false);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Error al crear");
    } finally {
      setBusy(false);
    }
  }

  async function onPay(e: FormEvent) {
    e.preventDefault();
    if (!payModal) return;
    setFormError(null);
    setBusy(true);
    try {
      await api<Payment>("/payments", {
        method: "POST",
        body: { membership_id: payModal.id, amount: Number(payForm.amount), method: payForm.method },
      });
      setPayModal(null);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Error al registrar pago");
    } finally {
      setBusy(false);
    }
  }

  async function onCancel(m: Membership) {
    if (!confirm(`¿Cancelar la membresía #${m.id}? La baja es voluntaria y definitiva.`)) return;
    try {
      await api(`/memberships/${m.id}`, { method: "PUT", body: { status: "cancelada" } });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error al cancelar");
    }
  }

  return (
    <div>
      <PageHeader
        title="Membresías"
        subtitle={isStaff ? "Altas, renovaciones y cancelaciones" : "Tus membresías"}
        action={isStaff ? <button className="btn-primary" onClick={() => { setForm({ user_id: "", plan_id: "" }); setFormError(null); setCreateModal(true); }}>+ Nueva membresía</button> : undefined}
      />

      {isStaff && (
        <input className="input mb-4 max-w-sm" placeholder="Filtrar por miembro..." value={filter} onChange={(e) => setFilter(e.target.value)} />
      )}

      {rows.length === 0 ? (
        <EmptyState title={isStaff ? "Sin membresías" : "Todavía no tenés membresías"} hint={isStaff ? "Cargá una desde el botón superior" : "Acercate a recepción"} />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-zinc-800">
              <tr>
                <th className="th">Miembro</th>
                <th className="th">Plan</th>
                <th className="th">Vigencia</th>
                <th className="th">Estado</th>
                <th className="th text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {rows.map((m) => {
                const plan = planById.get(m.plan_id);
                return (
                  <tr key={m.id} className="transition hover:bg-zinc-800/30">
                    <td className="td">
                      {isStaff ? (
                        <>
                          <span className="font-medium text-zinc-100">{userById.get(m.user_id)?.name ?? `#${m.user_id}`}</span>
                          <span className="block text-xs text-zinc-500">{userById.get(m.user_id)?.email}</span>
                        </>
                      ) : (
                        <span className="font-medium text-zinc-100">Plan {plan?.name ?? `#${m.plan_id}`}</span>
                      )}
                    </td>
                    <td className="td">{isStaff ? plan?.name ?? `#${m.plan_id}` : (plan ? `${plan.name} · $${plan.price.toLocaleString("es-AR")}` : `#${m.plan_id}`)}</td>
                    <td className="td text-zinc-500">{fmtDate(m.start_date)} → {fmtDate(m.end_date)}</td>
                    <td className="td"><Badge value={m.status} /></td>
                    <td className="td text-right whitespace-nowrap">
                      {isStaff && m.status === "activa" && (
                        <button className="mr-3 text-sm text-lime-300 hover:text-lime-200" onClick={() => { setPayForm({ amount: String(plan?.price ?? ""), method: "efectivo" }); setFormError(null); setPayModal(m); }}>
                          Renovar
                        </button>
                      )}
                      {isAdmin && m.status === "activa" && (
                        <button className="text-sm text-red-400 hover:text-red-300" onClick={() => onCancel(m)}>Cancelar</button>
                      )}
                      {!(isStaff && m.status === "activa") && !(isAdmin && m.status === "activa") && <span className="text-xs text-zinc-600">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {createModal && (
        <Modal title="Nueva membresía" onClose={() => setCreateModal(false)}>
          <form onSubmit={onCreate} className="space-y-4">
            {formError && <Alert kind="error">{formError}</Alert>}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-300">Miembro</label>
              <select className="input" required value={form.user_id} onChange={(e) => setForm({ ...form, user_id: e.target.value })}>
                <option value="" disabled>Seleccionar miembro...</option>
                {users.filter((u) => u.role === "miembro").map((u) => (
                  <option key={u.id} value={u.id}>{u.name} — {u.email}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-300">Plan</label>
              <select className="input" required value={form.plan_id} onChange={(e) => setForm({ ...form, plan_id: e.target.value })}>
                <option value="" disabled>Seleccionar plan...</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} — ${p.price.toLocaleString("es-AR")} ({p.duration_days} días)</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={() => setCreateModal(false)}>Cancelar</button>
              <button className="btn-primary" disabled={busy}>{busy ? "Creando..." : "Crear"}</button>
            </div>
          </form>
        </Modal>
      )}

      {payModal && (
        <Modal title={`Renovar membresía #${payModal.id}`} onClose={() => setPayModal(null)}>
          <form onSubmit={onPay} className="space-y-4">
            <p className="text-sm text-zinc-500">
              Plan {planById.get(payModal.plan_id)?.name} · vence el {fmtDate(payModal.end_date)}. El pago extiende la vigencia.
            </p>
            {formError && <Alert kind="error">{formError}</Alert>}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-300">Monto</label>
              <input className="input" type="number" min={0} step="0.01" required value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-300">Método</label>
              <select className="input" value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}>
                <option value="efectivo">Efectivo</option>
                <option value="tarjeta">Tarjeta</option>
                <option value="transferencia">Transferencia</option>
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={() => setPayModal(null)}>Cancelar</button>
              <button className="btn-primary" disabled={busy}>{busy ? "Registrando..." : "Registrar pago"}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
