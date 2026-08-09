import { ReactNode, useEffect } from "react";

export function Spinner({ label = "Cargando..." }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-zinc-400">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-600 border-t-lime-400" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function Alert({ kind, children }: { kind: "error" | "success"; children: ReactNode }) {
  const styles =
    kind === "error"
      ? "border-red-800 bg-red-950/50 text-red-300"
      : "border-lime-800 bg-lime-950/40 text-lime-300";
  return <div className={`rounded-lg border px-4 py-3 text-sm ${styles}`}>{children}</div>;
}

const BADGE_STYLES: Record<string, string> = {
  activa: "bg-lime-500/15 text-lime-300 border-lime-500/30",
  vencida: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  cancelada: "bg-red-500/15 text-red-300 border-red-500/30",
  reservada: "bg-lime-500/15 text-lime-300 border-lime-500/30",
  completado: "bg-lime-500/15 text-lime-300 border-lime-500/30",
  admin: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  recepcion: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  entrenador: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  miembro: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
};

export function Badge({ value }: { value: string }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${BADGE_STYLES[value] ?? "bg-zinc-500/15 text-zinc-300 border-zinc-500/30"}`}>
      {value}
    </span>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="card flex flex-col items-center gap-1 px-6 py-14 text-center">
      <p className="font-medium text-zinc-300">{title}</p>
      {hint && <p className="text-sm text-zinc-500">{hint}</p>}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className={`card max-h-[90vh] w-full ${wide ? "max-w-2xl" : "max-w-md"} overflow-y-auto p-6`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-100">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200" aria-label="Cerrar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-100">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string | number;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className={`card p-5 ${accent ? "border-lime-400/40 bg-lime-400/5" : ""}`}>
      <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-2 text-3xl font-bold tabular-nums text-zinc-100">{value}</p>
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

// Convierte un timestamp UTC del backend ('YYYY-MM-DD HH:MM:SS') en formato local
export function fmtDateTime(ts: string): string {
  if (!ts) return "—";
  // El backend devuelve texto UTC sin zona: lo interpretamos como UTC para mostrarlo local
  const d = new Date(ts.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function fmtDate(date: string): string {
  if (!date) return "—";
  return date;
}
