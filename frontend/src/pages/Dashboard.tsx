import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import {
  api,
  ApiError,
  BodyMetric,
  DashboardSummary,
  GymClass,
  Membership,
  Routine,
} from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Alert, Badge, EmptyState, PageHeader, Spinner, StatCard, fmtDate, fmtDateTime } from "../components/ui";

export default function Dashboard() {
  const { user } = useAuth();
  // El entrenador no accede al dashboard de negocio (backend: admin/recepcion):
  // su home natural es el catálogo de clases.
  if (user?.role === "entrenador") return <Navigate to="/clases" replace />;
  return user?.role === "miembro" ? <MemberHome /> : <StaffDashboard />;
}

// --- Staff: KPIs del bundle /api/dashboard/summary --------------------------

function StaffDashboard() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<DashboardSummary>("/dashboard/summary")
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Error al cargar el dashboard"));
  }, []);

  if (error) return <Alert kind="error">{error}</Alert>;
  if (!data) return <Spinner label="Calculando KPIs..." />;

  const maxDay = Math.max(...data.checkins.by_day_last_7d.map((d) => d.count), 1);
  const maxMethod = Math.max(...data.revenue.by_method_last_30d.map((m) => m.total), 1);
  const occupancy = Math.round(data.classes.avg_occupancy_7d * 100);

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Resumen de negocio de los últimos 7 y 30 días" />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Miembros totales" value={data.members.total} hint={`+${data.members.new_last_30d} en 30 días`} />
        <StatCard label="Membresías vigentes" value={data.memberships.active} accent hint="activa y sin vencer" />
        <StatCard label="Ingresos (30 días)" value={`$${data.revenue.last_30d.toLocaleString("es-AR", { minimumFractionDigits: 2 })}`} hint={`$${data.revenue.today.toLocaleString("es-AR")} hoy`} />
        <StatCard label="Check-ins (7 días)" value={data.checkins.last_7d_total} hint={`${data.checkins.today} hoy`} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-4 text-sm font-semibold text-zinc-300">Check-ins por día (últimos 7)</h2>
          <div className="flex h-40 items-end gap-2">
            {data.checkins.by_day_last_7d.map((d) => (
              <div key={d.date} className="group flex flex-1 flex-col items-center gap-1">
                <span className="text-xs font-medium text-zinc-400 opacity-0 transition group-hover:opacity-100">{d.count}</span>
                <div
                  className="w-full rounded-t-md bg-lime-400/80 transition group-hover:bg-lime-300"
                  style={{ height: `${Math.max((d.count / maxDay) * 100, d.count > 0 ? 6 : 2)}%` }}
                />
                <span className="text-[10px] text-zinc-500">{d.date.slice(8)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-5">
          <h2 className="mb-4 text-sm font-semibold text-zinc-300">Ingresos por método (30 días)</h2>
          {data.revenue.by_method_last_30d.length === 0 ? (
            <EmptyState title="Sin pagos en el período" />
          ) : (
            <div className="space-y-3">
              {data.revenue.by_method_last_30d.map((m) => (
                <div key={m.method}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="capitalize text-zinc-300">{m.method}</span>
                    <span className="font-medium tabular-nums text-zinc-100">${m.total.toLocaleString("es-AR")}</span>
                  </div>
                  <div className="h-2 rounded-full bg-zinc-800">
                    <div className="h-2 rounded-full bg-lime-400/80" style={{ width: `${(m.total / maxMethod) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Membresías vencidas" value={data.memberships.breakdown.find((b) => b.status === "vencida")?.count ?? 0} />
        <StatCard label="Clases próximas (7 días)" value={data.classes.upcoming_7d} />
        <StatCard label="Reservas vigentes" value={data.classes.active_bookings} />
        <StatCard label="Ocupación promedio" value={`${occupancy}%`} hint="de las clases próximas" />
      </div>
    </div>
  );
}

// --- Miembro: resumen personal (membresía + rutinas + métricas + clases) -----

function MemberHome() {
  const { user } = useAuth();
  const [memberships, setMemberships] = useState<Membership[] | null>(null);
  const [routines, setRoutines] = useState<Routine[] | null>(null);
  const [metrics, setMetrics] = useState<BodyMetric[] | null>(null);
  const [classes, setClasses] = useState<GymClass[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api<Membership[]>("/memberships"),
      api<Routine[]>("/routines"),
      api<BodyMetric[]>("/metrics"),
      api<GymClass[]>("/classes"),
    ])
      .then(([m, r, met, c]) => {
        setMemberships(m);
        setRoutines(r);
        setMetrics(met);
        setClasses(c);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Error al cargar tus datos"));
  }, []);

  if (error) return <Alert kind="error">{error}</Alert>;
  if (!memberships || !routines || !metrics || !classes) return <Spinner label="Cargando tu resumen..." />;

  const active = memberships.find((m) => m.status === "activa");
  const lastMetric = metrics[metrics.length - 1];
  const firstMetric = metrics[0];
  const upcoming = classes.filter((c) => new Date(c.schedule_start.replace(" ", "T") + "Z") > new Date()).slice(0, 3);

  return (
    <div>
      <PageHeader title={`¡Hola, ${user?.name.split(" ")[0]}!`} subtitle="Tu actividad en el gimnasio" />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Membresía"
          value={active ? active.end_date : "Sin activa"}
          hint={active ? `vence el ${fmtDate(active.end_date)}` : "consultá en recepción"}
          accent={!!active}
        />
        <StatCard label="Rutinas asignadas" value={routines.length} />
        <StatCard label="Último peso" value={lastMetric?.weight_kg != null ? `${lastMetric.weight_kg} kg` : "—"} hint={lastMetric ? fmtDate(lastMetric.date) : "todavía no te mediste"} />
        <StatCard
          label="Progreso"
          value={firstMetric?.weight_kg != null && lastMetric?.weight_kg != null ? `${(firstMetric.weight_kg - lastMetric.weight_kg).toFixed(1)} kg` : "—"}
          hint="desde la primera medición"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-300">Tus rutinas</h2>
            <Link to="/rutinas" className="text-xs font-medium text-lime-300 hover:text-lime-200">Ver todas →</Link>
          </div>
          {routines.length === 0 ? (
            <p className="text-sm text-zinc-500">Todavía no tenés rutinas asignadas.</p>
          ) : (
            <ul className="space-y-2">
              {routines.slice(0, 3).map((r) => (
                <li key={r.id} className="flex items-center justify-between rounded-lg border border-zinc-800 px-3 py-2.5">
                  <span className="text-sm text-zinc-200">{r.name}</span>
                  <span className="text-xs text-zinc-500">{r.exercises?.length ?? "—"} ejercicios</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-300">Clases próximas</h2>
            <Link to="/clases" className="text-xs font-medium text-lime-300 hover:text-lime-200">Reservar →</Link>
          </div>
          {upcoming.length === 0 ? (
            <p className="text-sm text-zinc-500">No hay clases próximas en el catálogo.</p>
          ) : (
            <ul className="space-y-2">
              {upcoming.map((c) => (
                <li key={c.id} className="flex items-center justify-between rounded-lg border border-zinc-800 px-3 py-2.5">
                  <span className="text-sm text-zinc-200">{c.name}</span>
                  <span className="text-xs text-zinc-500">{fmtDateTime(c.schedule_start)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-300">Tus membresías</h2>
        {memberships.length === 0 ? (
          <EmptyState title="Sin membresías registradas" hint="Acercate a recepción para darte de alta" />
        ) : (
          <div className="card divide-y divide-zinc-800">
            {memberships.map((m) => (
              <div key={m.id} className="flex items-center justify-between px-5 py-3.5">
                <div>
                  <p className="text-sm font-medium text-zinc-200">Plan #{m.plan_id}</p>
                  <p className="text-xs text-zinc-500">{fmtDate(m.start_date)} → {fmtDate(m.end_date)}</p>
                </div>
                <Badge value={m.status} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
