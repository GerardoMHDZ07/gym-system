import { useState } from "react";
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { roleLabel } from "../api/client";

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  roles: string[];
}

const icon = (path: string) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={path} />
  </svg>
);

const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", roles: ["admin", "recepcion"], icon: icon("M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z") },
  { to: "/miembros", label: "Miembros", roles: ["admin", "recepcion"], icon: icon("M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm13 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75") },
  { to: "/membresias", label: "Membresías", roles: ["admin", "recepcion", "miembro"], icon: icon("M12 2 3 7v6c0 5.25 3.83 8.1 9 11 5.17-2.9 9-5.75 9-11V7l-9-5z") },
  { to: "/pagos", label: "Pagos", roles: ["admin", "recepcion", "miembro"], icon: icon("M2 9h20v11H2zM2 5h20v3H2zm6 8h8") },
  { to: "/checkins", label: "Check-ins", roles: ["admin", "recepcion"], icon: icon("M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zm-2-6 5-5m-5 5-2.5-2.5") },
  { to: "/clases", label: "Clases", roles: ["admin", "recepcion", "entrenador", "miembro"], icon: icon("M8 7V3m8 4V3M3 7h18v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7zm2 6h14M10 13v4m4-4v4") },
  { to: "/reservas", label: "Reservas", roles: ["admin", "recepcion", "miembro"], icon: icon("M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z") },
  { to: "/ejercicios", label: "Ejercicios", roles: ["admin", "recepcion", "entrenador", "miembro"], icon: icon("M4 8h16M4 16h16M9 3v18m6-18v18") },
  { to: "/rutinas", label: "Rutinas", roles: ["admin", "recepcion", "entrenador", "miembro"], icon: icon("M4 6h16M4 12h16M4 18h10M16 18v-3") },
  { to: "/metricas", label: "Métricas", roles: ["admin", "recepcion", "entrenador", "miembro"], icon: icon("M4 19V5m0 14h16M8 15v-4m4 4V7m4 8v-6") },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  // Sin sesión no hay layout que pintar: al login, con la ruta de origen para
  // volver tras loguearse (mismo patrón que ProtectedRoute). Sin este guard, un
  // visitante que entra directo a /miembros vería pantalla en blanco.
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  const items = NAV.filter((n) => n.roles.includes(user.role));

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-lime-400 text-lg font-black text-zinc-950">G</div>
        <div>
          <p className="text-sm font-bold text-zinc-100">Gym System</p>
          <p className="text-[11px] text-zinc-500">Gestión de gimnasio</p>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                isActive ? "bg-lime-400/10 text-lime-300" : "text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-100"
              }`
            }
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-zinc-800 p-4">
        <p className="truncate text-sm font-medium text-zinc-200">{user.name}</p>
        <p className="text-xs text-zinc-500">{roleLabel(user.role)}</p>
        <button
          onClick={() => {
            logout();
            navigate("/login");
          }}
          className="mt-3 w-full rounded-lg border border-zinc-800 px-3 py-2 text-sm text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
        >
          Cerrar sesión
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      {/* Sidebar desktop */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-zinc-800 bg-zinc-950 lg:block">{sidebar}</aside>

      {/* Drawer mobile */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/70" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-60 border-r border-zinc-800 bg-zinc-950">{sidebar}</aside>
        </div>
      )}

      <div className="flex min-h-screen flex-1 flex-col lg:pl-60">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-zinc-800 bg-zinc-950/80 px-4 py-3 backdrop-blur lg:px-8">
          <button onClick={() => setOpen(true)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800 lg:hidden" aria-label="Abrir menú">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
          </button>
          <p className="text-sm text-zinc-500">
            {user.name} · <span className="text-lime-300">{roleLabel(user.role)}</span>
          </p>
        </header>
        <main className="flex-1 px-4 py-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
