import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import env from "./config/env.js";
import authRoutes from "./routes/authRoutes.js";
import fhirRoutes from "./routes/fhirRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import publicRoutes from "./routes/publicRoutes.js";
import agentRoutes from "./routes/agentRoutes.js";
import { requestAuditTrail } from "./middleware/audit.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: env.corsOrigin,
    credentials: true
  })
);
app.options("*", cors());
app.use(express.json({ limit: "1mb", type: ["application/json", "application/fhir+json"] }));
app.use(morgan("combined"));

app.use(
  "/api/auth",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false
  }),
  authRoutes
);

app.use(
  "/api/public",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    standardHeaders: true,
    legacyHeaders: false
  }),
  publicRoutes
);

app.use(requestAuditTrail);
app.use("/api/fhir", fhirRoutes);
app.use("/api/admin", adminRoutes);

// AI assistant. Its tools call /api/fhir and /api/admin internally, so each action
// the agent takes is itself authorised and audited by those routes.
app.use(
  "/api/agent",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false
  }),
  agentRoutes
);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
