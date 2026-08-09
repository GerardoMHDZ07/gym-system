import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { ApiUser, getToken } from "./api/client";

// Test de integración: App real (rutas + Layout + ProtectedRoute + páginas),
// AuthProvider real y SOLO la función api() mockeada con respuestas por ruta.
// Reproduce el flujo del usuario en el browser: login → navegación → logout.
const apiMock = vi.hoisted(() => vi.fn());

vi.mock("./api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api/client")>();
  return { ...actual, api: apiMock };
});

const ADMIN: ApiUser = { id: 1, name: "Ana Admin", email: "admin@gym.local", role: "admin", created_at: "2026-01-01" };
const MIEMBRO: ApiUser = { id: 2, name: "Miguel Ruiz", email: "miguel@gym.local", role: "miembro", created_at: "2026-01-01" };

const USER_BY_EMAIL: Record<string, ApiUser> = {
  "admin@gym.local": ADMIN,
  "miguel@gym.local": MIEMBRO,
};

const SUMMARY = {
  members: { total: 12, new_last_30d: 3 },
  memberships: {
    active: 8,
    breakdown: [
      { status: "activa", count: 8 },
      { status: "vencida", count: 2 },
      { status: "cancelada", count: 1 },
    ],
  },
  checkins: { today: 5, last_7d_total: 30, by_day_last_7d: [{ date: "2026-08-08", count: 5 }] },
  revenue: { today: 1000, last_30d: 30000, by_method_last_30d: [{ method: "efectivo", total: 30000 }] },
  classes: { upcoming_7d: 6, active_bookings: 20, avg_occupancy_7d: 0.6 },
};

function renderApp(initialPath = "/login") {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <App />
      </MemoryRouter>
    </AuthProvider>
  );
}

// El backend "vivo" de este test: respuestas por endpoint con la misma forma
// que el contrato real.
function stubApi() {
  apiMock.mockImplementation(async (path: string, options?: { body?: unknown }) => {
    if (path === "/auth/login") {
      const email = (options?.body as { email?: string })?.email ?? "";
      const user = USER_BY_EMAIL[email] ?? ADMIN;
      return { token: `tok-${user.role}`, user };
    }
    if (path === "/dashboard/summary") return SUMMARY;
    if (path === "/users") {
      return [
        { id: 3, name: "Carla", email: "carla@gym.local", role: "entrenador", created_at: "2026-01-01" },
        { id: 4, name: "Sofía", email: "sofia@gym.local", role: "miembro", created_at: "2026-01-01" },
      ];
    }
    // Home del miembro: resumen personal (todas vacías, suficiente para renderizar)
    if (path === "/memberships" || path === "/routines" || path === "/metrics" || path === "/classes") return [];
    // Endpoint no contemplado: fallar alto en vez de devolver [] a ciegas, así el
    // stub funciona como guarda de contrato si la app empieza a llamar a otro lado.
    throw new Error(`Endpoint inesperado en el stub de App.test: ${path}`);
  });
}

async function loginAs(user: UserEvent, email: string) {
  await user.click(screen.getByRole("button", { name: new RegExp(email, "i") }));
  await user.click(screen.getByRole("button", { name: "Ingresar" }));
}

describe("App (integración)", () => {
  beforeEach(() => {
    apiMock.mockReset();
    localStorage.clear();
    stubApi();
  });

  it("login real con la API mockeada llega al dashboard de staff", async () => {
    const user = userEvent.setup();
    renderApp("/login");

    await loginAs(user, "admin@gym.local");

    expect(apiMock).toHaveBeenCalledWith("/auth/login", expect.objectContaining({ method: "POST" }));
    expect(getToken()).toBe("tok-admin");
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByText("Miembros totales")).toBeInTheDocument();
    expect(screen.getByText("Check-ins (7 días)")).toBeInTheDocument();
    // La nav del admin incluye las secciones de staff
    expect(screen.getByRole("link", { name: "Miembros" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Check-ins" })).toBeInTheDocument();
  });

  it("el admin navega a Miembros desde la sidebar y ve el listado", async () => {
    const user = userEvent.setup();
    renderApp("/login");
    await loginAs(user, "admin@gym.local");
    await screen.findByRole("heading", { name: "Dashboard" });

    await user.click(screen.getByRole("link", { name: "Miembros" }));

    expect(await screen.findByRole("heading", { name: "Miembros" })).toBeInTheDocument();
    expect(screen.getByText("carla@gym.local")).toBeInTheDocument();
  });

  it("el miembro no ve secciones de staff y un acceso directo a /miembros redirige a su home", async () => {
    const user = userEvent.setup();
    // Sin sesión, ProtectedRoute manda al login con la ruta de origen (/miembros)
    renderApp("/miembros");
    expect(await screen.findByPlaceholderText("demo1234")).toBeInTheDocument();

    await loginAs(user, "miguel@gym.local");

    // Tras el login hay dos navegaciones que convergen a "/" (home del miembro):
    // Login re-renderiza con user y su <Navigate to="/">, y onSubmit hace
    // navigate(from="/miembros") que el guard rebota a "/" por rol. El estado
    // final es determinista: MemberHome.
    expect(await screen.findByText("¡Hola, Miguel!")).toBeInTheDocument();
    expect(screen.getByText("Tu actividad en el gimnasio")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Miembros" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Check-ins" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Membresías" })).toBeInTheDocument();
  });

  it("cerrar sesión desde la app vuelve al login y limpia el token", async () => {
    const user = userEvent.setup();
    renderApp("/login");
    await loginAs(user, "admin@gym.local");
    await screen.findByRole("heading", { name: "Dashboard" });

    await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    expect(getToken()).toBeNull();
    expect(await screen.findByPlaceholderText("demo1234")).toBeInTheDocument();
  });

  it("una ruta inexistente cae en el login", async () => {
    renderApp("/no-existe");
    expect(await screen.findByPlaceholderText("demo1234")).toBeInTheDocument();
  });
});
