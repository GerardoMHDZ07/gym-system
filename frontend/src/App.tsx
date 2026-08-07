import { Routes, Route } from "react-router-dom";
import Dashboard from "./pages/Dashboard";

// TODO: agregar rutas por módulo a medida que se implementan las fases:
// /miembros /clases /rutinas /pagos /metricas

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
    </Routes>
  );
}
