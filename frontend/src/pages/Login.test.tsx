import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ApiError, ApiUser } from "../api/client";
import Login from "./Login";

const auth = vi.hoisted(() => ({
  user: null as ApiUser | null,
  login: vi.fn<(email: string, password: string) => Promise<void>>(),
  logout: vi.fn(),
}));

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ user: auth.user, login: auth.login, logout: auth.logout }),
}));

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<p>pagina-home</p>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("Login", () => {
  beforeEach(() => {
    auth.user = null;
    auth.login.mockReset();
    auth.login.mockResolvedValue(undefined);
  });

  it("las cuentas demo completan el formulario al hacer click", async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByRole("button", { name: /admin@gym.local/i }));

    expect(screen.getByPlaceholderText("admin@gym.local")).toHaveValue("admin@gym.local");
    expect(screen.getByPlaceholderText("demo1234")).toHaveValue("demo1234");
  });

  it("un login exitoso navega a la home", async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByPlaceholderText("admin@gym.local"), "admin@gym.local");
    await user.type(screen.getByPlaceholderText("demo1234"), "demo1234");
    await user.click(screen.getByRole("button", { name: "Ingresar" }));

    expect(auth.login).toHaveBeenCalledWith("admin@gym.local", "demo1234");
    expect(await screen.findByText("pagina-home")).toBeInTheDocument();
  });

  it("un login fallido muestra el error del server y no navega", async () => {
    auth.login.mockRejectedValue(new ApiError(401, "Credenciales inválidas"));
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByPlaceholderText("admin@gym.local"), "x@x.com");
    await user.type(screen.getByPlaceholderText("demo1234"), "mal");
    await user.click(screen.getByRole("button", { name: "Ingresar" }));

    expect(await screen.findByText("Credenciales inválidas")).toBeInTheDocument();
    expect(screen.queryByText("pagina-home")).not.toBeInTheDocument();
  });

  it("si ya hay sesión redirige a la home", async () => {
    auth.user = { id: 1, name: "Ana", email: "ana@gym.local", role: "miembro", created_at: "2026-01-01" };
    renderLogin();
    expect(await screen.findByText("pagina-home")).toBeInTheDocument();
  });
});
