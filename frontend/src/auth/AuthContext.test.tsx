import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider, useAuth } from "./AuthContext";
import { getStoredUser, getToken, setStoredUser } from "../api/client";

const USER = { id: 1, name: "Ana", email: "ana@gym.local", role: "miembro" as const, created_at: "2026-01-01" };

function Harness() {
  const { user, login, logout } = useAuth();
  const [err, setErr] = useState("");
  return (
    <div>
      <span data-testid="email">{user?.email ?? "anon"}</span>
      <button onClick={() => login("ana@gym.local", "demo1234").catch((e: Error) => setErr(e.message))}>login</button>
      <button onClick={logout}>logout</button>
      {err && <span data-testid="error">{err}</span>}
    </div>
  );
}

function renderHarness() {
  return render(
    <AuthProvider>
      <Harness />
    </AuthProvider>
  );
}

describe("AuthProvider", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it("arranca sin sesión si no hay usuario guardado", () => {
    renderHarness();
    expect(screen.getByTestId("email")).toHaveTextContent("anon");
  });

  it("recupera la sesión guardada en localStorage", () => {
    setStoredUser(USER);
    renderHarness();
    expect(screen.getByTestId("email")).toHaveTextContent("ana@gym.local");
  });

  it("login guarda token y usuario y actualiza el estado", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ token: "tok-1", user: USER }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole("button", { name: "login" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "ana@gym.local", password: "demo1234" }),
      })
    );
    expect(getToken()).toBe("tok-1");
    expect(getStoredUser()?.email).toBe("ana@gym.local");
    await waitFor(() => expect(screen.getByTestId("email")).toHaveTextContent("ana@gym.local"));
  });

  it("un login fallido propaga el error del server", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: "Credenciales inválidas" }) })
    );
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole("button", { name: "login" }));

    expect(await screen.findByTestId("error")).toHaveTextContent("Credenciales inválidas");
    // Parte del contrato del 401: la sesión queda limpia
    expect(getToken()).toBeNull();
    expect(getStoredUser()).toBeNull();
  });

  it("el evento gym:unauthorized cierra la sesión en vivo (token expirado)", async () => {
    setStoredUser(USER);
    renderHarness();
    expect(screen.getByTestId("email")).toHaveTextContent("ana@gym.local");

    window.dispatchEvent(new Event("gym:unauthorized"));

    // El estado se actualiza en el siguiente render (React 18 batching)
    await waitFor(() => expect(screen.getByTestId("email")).toHaveTextContent("anon"));
  });

  it("logout limpia el token, el usuario guardado y el estado", async () => {
    setStoredUser(USER);
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole("button", { name: "logout" }));

    expect(getToken()).toBeNull();
    expect(getStoredUser()).toBeNull();
    expect(screen.getByTestId("email")).toHaveTextContent("anon");
  });
});
