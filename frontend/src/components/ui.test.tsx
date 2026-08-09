import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { roleLabel } from "../api/client";
import { Badge, fmtDate, fmtDateTime } from "./ui";

describe("roleLabel", () => {
  it("traduce roles conocidos y deja pasar los desconocidos", () => {
    expect(roleLabel("admin")).toBe("Admin");
    expect(roleLabel("recepcion")).toBe("Recepción");
    expect(roleLabel("miembro")).toBe("Miembro");
    expect(roleLabel("inventado")).toBe("inventado");
  });
});

describe("fmtDateTime", () => {
  it("formatea timestamps UTC en hora local con formato es-AR", () => {
    const ts = "2026-08-08 14:30:00";
    // Compara contra el mismo formateo local del runner: no depende de la TZ
    // de la máquina ni de que el entorno aplique TZ=UTC (Windows la ignora).
    const expected = new Date("2026-08-08T14:30:00Z").toLocaleString("es-AR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    expect(fmtDateTime(ts)).toBe(expected);
    expect(fmtDateTime(ts)).not.toBe("—");
  });

  it("devuelve — para vacío y el input tal cual si no es una fecha válida", () => {
    expect(fmtDateTime("")).toBe("—");
    expect(fmtDateTime("no-es-fecha")).toBe("no-es-fecha");
  });
});

describe("fmtDate", () => {
  it("pasa fechas DATE y devuelve — para vacío", () => {
    expect(fmtDate("2026-08-08")).toBe("2026-08-08");
    expect(fmtDate("")).toBe("—");
  });
});

describe("Badge", () => {
  it("muestra el valor del status", () => {
    render(<Badge value="activa" />);
    expect(screen.getByText("activa")).toBeInTheDocument();
  });
});
