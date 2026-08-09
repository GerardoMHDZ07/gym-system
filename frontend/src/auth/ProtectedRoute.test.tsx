import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider, ProtectedRoute } from "./AuthContext";
import { setStoredUser } from "../api/client";

function renderAt(path: string) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<p>pagina-login</p>} />
          <Route path="/" element={<p>pagina-home</p>} />
          <Route
            path="/privado"
            element={
              <ProtectedRoute roles={["admin"]}>
                <p>contenido-secreto</p>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );
}

describe("ProtectedRoute", () => {
  beforeEach(() => localStorage.clear());

  it("sin sesión redirige a /login y no muestra el contenido", async () => {
    renderAt("/privado");
    expect(await screen.findByText("pagina-login")).toBeInTheDocument();
    expect(screen.queryByText("contenido-secreto")).not.toBeInTheDocument();
  });

  it("con rol no permitido redirige a /", async () => {
    setStoredUser({ id: 2, name: "Sofi", email: "sofia@gym.local", role: "miembro", created_at: "2026-01-01" });
    renderAt("/privado");
    expect(await screen.findByText("pagina-home")).toBeInTheDocument();
    expect(screen.queryByText("contenido-secreto")).not.toBeInTheDocument();
  });

  it("con el rol permitido muestra el contenido", async () => {
    setStoredUser({ id: 1, name: "Ana", email: "ana@gym.local", role: "admin", created_at: "2026-01-01" });
    renderAt("/privado");
    expect(await screen.findByText("contenido-secreto")).toBeInTheDocument();
  });
});
