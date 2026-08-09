import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import { ProtectedRoute } from "./auth/AuthContext";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Members from "./pages/Members";
import Memberships from "./pages/Memberships";
import Payments from "./pages/Payments";
import Checkins from "./pages/Checkins";
import Classes from "./pages/Classes";
import Bookings from "./pages/Bookings";
import Exercises from "./pages/Exercises";
import Routines from "./pages/Routines";
import Metrics from "./pages/Metrics";

const STAFF = ["admin", "recepcion"];
const ALL = ["admin", "recepcion", "entrenador", "miembro"];

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route element={<Layout />}>
        <Route path="/" element={<ProtectedRoute roles={ALL}><Dashboard /></ProtectedRoute>} />

        <Route path="/miembros" element={<ProtectedRoute roles={STAFF}><Members /></ProtectedRoute>} />
        <Route path="/membresias" element={<ProtectedRoute roles={ALL}><Memberships /></ProtectedRoute>} />
        <Route path="/pagos" element={<ProtectedRoute roles={ALL}><Payments /></ProtectedRoute>} />
        <Route path="/checkins" element={<ProtectedRoute roles={STAFF}><Checkins /></ProtectedRoute>} />
        <Route path="/clases" element={<ProtectedRoute roles={ALL}><Classes /></ProtectedRoute>} />
        <Route path="/reservas" element={<ProtectedRoute roles={ALL}><Bookings /></ProtectedRoute>} />
        <Route path="/ejercicios" element={<ProtectedRoute roles={ALL}><Exercises /></ProtectedRoute>} />
        <Route path="/rutinas" element={<ProtectedRoute roles={ALL}><Routines /></ProtectedRoute>} />
        <Route path="/metricas" element={<ProtectedRoute roles={ALL}><Metrics /></ProtectedRoute>} />
      </Route>

      <Route path="*" element={<Login />} />
    </Routes>
  );
}
