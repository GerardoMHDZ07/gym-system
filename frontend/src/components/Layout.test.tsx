import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Layout from "./Layout";
import { AuthProvider } from "../auth/AuthContext";
import { ApiUser, getToken, setStoredUser } from "../api/client";

function renderLayout(role: ApiUser["role"]) {
  setStoredUser({ id: 1, name: "Ana", email: "ana@gym.local", role, created_at: "2026-01-01" });
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/login" element={<p>pagina-login</p>} />
          <Route path="/" element={<Layout />}>
            <Route index element={<p>contenido</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );
}

describe("Layout", () => {
  beforeEach(() => localStorage.clear());

  it("el admin ve toda la navegación", () => {
    renderLayout("admin");
    expect(screen.getByRole("link", { name: "Miembros" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Check-ins" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Rutinas" })).toBeInTheDocument();
  });

  it("el miembro no ve las secciones de staff", () => {
    renderLayout("miembro");
    expect(screen.queryByRole("link", { name: "Miembros" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Check-ins" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Dashboard" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clases" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Métricas" })).toBeInTheDocument();
  });

  it("muestra el nombre y el rol del usuario", () => {
    renderLayout("entrenador");
    expect(screen.getAllByText("Ana").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Entrenador").length).toBeGreaterThan(0);
  });

  it("cerrar sesión limpia el token y navega al login", async () => {
    const user = userEvent.setup();
    renderLayout("admin");
    await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    expect(getToken()).toBeNull();
    expect(await screen.findByText("pagina-login")).toBeInTheDocument();
  });
});
