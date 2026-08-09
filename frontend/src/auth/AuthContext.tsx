import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { api, ApiUser, getStoredUser, setStoredUser, setToken } from "../api/client";

interface AuthContextValue {
  user: ApiUser | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<ApiUser | null>(getStoredUser());

  // Si el token expira (cualquier 401 del client), se cierra la sesión en vivo
  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener("gym:unauthorized", onUnauthorized);
    return () => window.removeEventListener("gym:unauthorized", onUnauthorized);
  }, []);

  async function login(email: string, password: string) {
    const res = await api<{ token: string; user: ApiUser }>("/auth/login", {
      method: "POST",
      body: { email, password },
    });
    setToken(res.token);
    setStoredUser(res.user);
    setUser(res.user);
  }

  function logout() {
    setToken(null);
    setStoredUser(null);
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de AuthProvider");
  return ctx;
}

// Guard de rutas: si no hay sesión -> /login; si el rol no está permitido -> /
export function ProtectedRoute({ roles, children }: { roles?: string[]; children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();

  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}
