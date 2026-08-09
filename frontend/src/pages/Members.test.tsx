import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../auth/AuthContext";
import { setStoredUser } from "../api/client";
import Members from "./Members";

// Patrón para tests de página: se mockea solo la función api() del cliente y
// el resto del módulo (ApiError, ROLES, roleLabel) se mantiene real.
const apiMock = vi.hoisted(() => vi.fn());

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: apiMock };
});

const ANA = { id: 1, name: "Ana", email: "ana@gym.local", role: "miembro" as const, created_at: "2026-01-01" };
const JORGE = { id: 2, name: "Jorge", email: "jorge@gym.local", role: "entrenador" as const, created_at: "2026-02-01" };

function renderMembers(role: "admin" | "recepcion") {
  setStoredUser({ id: 9, name: "Staff", email: "staff@gym.local", role, created_at: "2026-01-01" });
  return render(
    <AuthProvider>
      <MemoryRouter>
        <Members />
      </MemoryRouter>
    </AuthProvider>
  );
}

describe("Members", () => {
  beforeEach(() => {
    apiMock.mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    // Restaura el spy de confirm para que no filtre a otros tests del archivo
    vi.restoreAllMocks();
  });

  it("carga y lista los usuarios", async () => {
    apiMock.mockResolvedValue([ANA, JORGE]);
    renderMembers("admin");

    expect(await screen.findByText("Ana")).toBeInTheDocument();
    expect(screen.getByText("jorge@gym.local")).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith("/users");
  });

  it("filtra la tabla con la búsqueda", async () => {
    apiMock.mockResolvedValue([ANA, JORGE]);
    const user = userEvent.setup();
    renderMembers("admin");
    await screen.findByText("Ana");

    await user.type(screen.getByPlaceholderText("Buscar por nombre o email..."), "jorge");

    expect(screen.queryByText("Ana")).not.toBeInTheDocument();
    expect(screen.getByText("jorge@gym.local")).toBeInTheDocument();
  });

  it("el admin ve el botón Eliminar", async () => {
    apiMock.mockResolvedValue([ANA]);
    renderMembers("admin");

    expect(await screen.findByRole("button", { name: "Eliminar" })).toBeInTheDocument();
  });

  it("la recepción no ve el botón Eliminar", async () => {
    apiMock.mockResolvedValue([ANA]);
    renderMembers("recepcion");
    await screen.findByText("Ana");

    expect(screen.queryByRole("button", { name: "Eliminar" })).not.toBeInTheDocument();
  });

  it("eliminar pide confirmación, llama al DELETE y recarga la lista", async () => {
    apiMock.mockResolvedValue([ANA]);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    renderMembers("admin");
    await screen.findByText("Ana");

    await user.click(screen.getByRole("button", { name: "Eliminar" }));

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(`/users/${ANA.id}`, { method: "DELETE" });
    });
    expect(apiMock).toHaveBeenLastCalledWith("/users");
  });
});
