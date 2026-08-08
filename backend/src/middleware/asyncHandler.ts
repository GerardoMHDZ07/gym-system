import { NextFunction, Request, RequestHandler, Response } from "express";

// Express 4 no enruta los rechazos de handlers async al middleware de error:
// un throw se convierte en unhandled rejection y la petición queda colgada sin
// respuesta. Este wrapper los captura y los reenvía con next().
export const asyncHandler =
  (fn: (...args: any[]) => Promise<unknown>): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
