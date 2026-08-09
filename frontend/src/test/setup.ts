// Setup común de la suite de tests del frontend (Vitest + Testing Library).
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Sin globals de Vitest, Testing Library no limpia el DOM solo: lo hacemos
// explícito después de cada test para que no haya estado colgado entre tests.
afterEach(() => cleanup());
