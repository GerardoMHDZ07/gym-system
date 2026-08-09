import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, getStoredUser, getToken, setStoredUser, setToken } from "./client";

const USER = { id: 1, name: "Ana", email: "ana@gym.local", role: "miembro" as const, created_at: "2026-01-01" };

describe("api()", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    localStorage.clear();
  });

  afterEach(() => vi.unstubAllGlobals());

  function jsonResponse(status: number, body: unknown) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  }

  it("hace GET a /api (path + query passthrough) sin header de auth si no hay sesión", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, []));
    await api("/users?user_id=5");
    expect(fetchMock).toHaveBeenCalledWith("/api/users?user_id=5", expect.objectContaining({ method: "GET" }));
    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers).toEqual({});
  });

  it("adjunta el token Bearer cuando hay sesión", async () => {
    setToken("token-123");
    fetchMock.mockResolvedValue(jsonResponse(200, []));
    await api("/users");
    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers).toEqual({ Authorization: "Bearer token-123" });
  });

  it("serializa el body en POST con Content-Type json", async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { id: 1 }));
    await api("/users", { method: "POST", body: { name: "Ana", email: "ana@gym.local" } });
    const [, options] = fetchMock.mock.calls[0];
    expect(options.method).toBe("POST");
    expect(options.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(options.body)).toEqual({ name: "Ana", email: "ana@gym.local" });
  });

  it("lanza ApiError con status y mensaje del server", async () => {
    fetchMock.mockResolvedValue(jsonResponse(409, { error: "Ya existe" }));
    const err = await api("/users").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).message).toBe("Ya existe");
  });

  it("un 401 limpia la sesión y dispara el evento gym:unauthorized", async () => {
    setToken("expirado");
    setStoredUser(USER);
    const unauthorized = vi.fn();
    window.addEventListener("gym:unauthorized", unauthorized);

    fetchMock.mockResolvedValue(jsonResponse(401, { error: "Token inválido" }));

    await expect(api("/users")).rejects.toBeInstanceOf(ApiError);
    expect(getToken()).toBeNull();
    expect(getStoredUser()).toBeNull();
    expect(unauthorized).toHaveBeenCalledTimes(1);
    window.removeEventListener("gym:unauthorized", unauthorized);
  });

  it("un body ilegible cae en el mensaje genérico con el status", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("boom");
      },
    });
    const err = await api("/users").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(500);
    expect((err as ApiError).message).toBe("Error 500");
  });

  it("un 204 devuelve undefined sin parsear el body", async () => {
    const json = vi.fn();
    fetchMock.mockResolvedValue({ ok: true, status: 204, json });
    await expect(api("/users/1", { method: "DELETE" })).resolves.toBeUndefined();
    expect(json).not.toHaveBeenCalled();
  });
});
