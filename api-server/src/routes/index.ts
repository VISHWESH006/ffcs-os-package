import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import healthRouter from "./health";
import ffcsRouter from "./ffcs";
import { requireFirebaseAuth } from "../lib/firebase-auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(requireFirebaseAuth);
router.use(ffcsRouter);
router.use((error: Error & { code?: string; statusCode?: number }, _req: Request, res: Response, next: NextFunction) => {
  if (error?.code !== "FFCS_STORE_UNAVAILABLE") return next(error);
  res.status(503).json({ error: error.message });
});

export default router;
