// Cliente HTTP del frontend: habla con el backend vía /api (proxied por Vite
// en dev y por nginx en prod). El token viaja en el header Authorization.

export interface ApiUser {
  id: number;
  name: string;
  email: string;
  role: "admin" | "recepcion" | "entrenador" | "miembro";
  created_at: string;
}

export interface Membership {
  id: number;
  user_id: number;
  plan_id: number;
  start_date: string;
  end_date: string;
  status: "activa" | "vencida" | "cancelada";
  created_at: string;
}

export interface MembershipPlan {
  id: number;
  name: string;
  duration_days: number;
  // El backend castea price a float8: llega como número
  price: number;
  description: string | null;
}

export interface Payment {
  id: number;
  membership_id: number;
  amount: number;
  payment_date: string;
  method: string;
  status: string;
  user_id?: number;
}

export interface Checkin {
  id: number;
  user_id: number;
  checkin_time: string;
}

export interface GymClass {
  id: number;
  name: string;
  trainer_id: number;
  schedule_start: string;
  schedule_end: string;
  capacity: number;
}

export interface Booking {
  id: number;
  class_id: number;
  user_id: number;
  status: "reservada" | "cancelada" | "asistio";
  booked_at: string;
  class_name?: string;
}

export interface Exercise {
  id: number;
  name: string;
  muscle_group: string | null;
  description: string | null;
  video_url: string | null;
}

export interface RoutineExercise {
  id: number;
  exercise_id: number;
  exercise_name: string;
  sets: number;
  reps: number;
  order_index: number;
  rest_seconds: number | null;
}

export interface Routine {
  id: number;
  name: string;
  created_by: number;
  assigned_to: number;
  notes: string | null;
  created_at: string;
  exercises?: RoutineExercise[];
}

export interface BodyMetric {
  id: number;
  user_id: number;
  date: string;
  weight_kg: number | null;
  body_fat_pct: number | null;
  notes: string | null;
}

export interface DashboardSummary {
  members: { total: number; new_last_30d: number };
  memberships: {
    active: number;
    breakdown: { status: string; count: number }[];
  };
  checkins: {
    today: number;
    last_7d_total: number;
    by_day_last_7d: { date: string; count: number }[];
  };
  revenue: {
    today: number;
    last_30d: number;
    by_method_last_30d: { method: string; total: number }[];
  };
  classes: {
    upcoming_7d: number;
    active_bookings: number;
    avg_occupancy_7d: number;
  };
}

export const ROLES: { value: ApiUser["role"]; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "recepcion", label: "Recepción" },
  { value: "entrenador", label: "Entrenador" },
  { value: "miembro", label: "Miembro" },
];

export function roleLabel(role: string): string {
  return ROLES.find((r) => r.value === role)?.label ?? role;
}

const TOKEN_KEY = "gym_token";
const USER_KEY = "gym_user";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}
export function getStoredUser(): ApiUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ApiUser;
  } catch {
    localStorage.removeItem(USER_KEY);
    return null;
  }
}
export function setStoredUser(user: ApiUser | null) {
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  else localStorage.removeItem(USER_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (data && data.error) || `Error ${res.status}`;
    if (res.status === 401) {
      setToken(null);
      setStoredUser(null);
      // Avisa al AuthContext para que limpie el estado (token expirado)
      window.dispatchEvent(new Event("gym:unauthorized"));
    }
    throw new ApiError(res.status, message);
  }
  return data as T;
}
