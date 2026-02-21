import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env";
import { contentRoutes } from "./routes/contentRoutes";

const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan("dev"));
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

function redactSapQuery(query: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = new Set(["seckey", "authid", "signature", "token", "authorization"]);

  return Object.fromEntries(
    Object.entries(query).map(([key, value]) => {
      if (sensitiveKeys.has(key.toLowerCase())) {
        return [key, "[REDACTED]"];
      }

      return [key, value];
    })
  );
}

app.use((req, _res, next) => {
  if (!env.SAP_TRACE_ALL_REQUESTS) {
    return next();
  }

  const userAgent = req.header("user-agent") || "";
  const traceUserAgentNeedle = env.SAP_TRACE_USER_AGENT.toLowerCase();
  const isLikelySapRequest =
    userAgent.toLowerCase().includes(traceUserAgentNeedle) ||
    req.path.toLowerCase().includes("contentserver.dll") ||
    req.path.toLowerCase().startsWith("/sap/");

  if (!isLikelySapRequest) {
    return next();
  }

  console.log(
    `[SAP-TRACE-ALL] ${JSON.stringify({
      method: req.method,
      path: req.path,
      originalUrl: req.originalUrl,
      query: redactSapQuery(req.query as Record<string, unknown>),
      contentType: req.header("content-type") || undefined,
      userAgent: userAgent || undefined,
      host: req.header("host") || undefined,
      referer: req.header("referer") || undefined,
      forwardedFor: req.header("x-forwarded-for") || undefined,
      methodOverride: req.header("x-http-method-override") || req.header("x-method-override") || undefined
    })}`
  );

  return next();
});

app.use((req, _res, next) => {
  const queryEntries = Object.entries(req.query as Record<string, unknown>);
  const queryKeys = queryEntries.map(([key]) => key.toLowerCase());
  const queryValues = queryEntries.map(([, value]) => String(value).toLowerCase());
  const accessMode = String(req.query.accessMode || req.query.accessmode || "").toLowerCase();
  const methodOverride =
    String(req.header("x-http-method-override") || req.header("x-method-override") || "").toUpperCase();
  const hasDeleteQueryKey = ["delete", "del", "remove", "deletecomp", "deletecontent", "cmd", "command"].some(
    (key) => queryKeys.includes(key)
  );
  const hasDeleteQueryValue = queryValues.some((value) =>
    ["delete", "del", "remove", "deletecomp", "deletecontent", "d", "x"].includes(value)
  );
  const isDeleteIntent =
    req.method === "DELETE" ||
    methodOverride === "DELETE" ||
    ["d", "delete", "x", "del", "remove"].includes(accessMode) ||
    hasDeleteQueryKey ||
    hasDeleteQueryValue;

  if (isDeleteIntent) {
    console.log(
      `[SAP-DELETE-PROBE] ${JSON.stringify({
        method: req.method,
        methodOverride: methodOverride || undefined,
        path: req.path,
        originalUrl: req.originalUrl,
        query: req.query,
        contentType: req.header("content-type") || undefined,
        userAgent: req.header("user-agent") || undefined,
        referer: req.header("referer") || undefined,
        forwardedFor: req.header("x-forwarded-for") || undefined
      })}`
    );
  }

  return next();
});

app.use(contentRoutes);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : String(err);
  const statusCode = (() => {
    if (typeof err === "object" && err !== null) {
      const candidate = err as { statusCode?: number; status?: number };
      if (typeof candidate.statusCode === "number") {
        return candidate.statusCode;
      }
      if (typeof candidate.status === "number") {
        return candidate.status;
      }
    }
    return 0;
  })();
  const isPayloadTooLarge =
    /payload too large/i.test(message) ||
    /exceeds limit/i.test(message) ||
    /request entity too large/i.test(message);

  if (statusCode >= 400 && statusCode < 500) {
    console.log(`[request-error:${statusCode}] ${message || "bad request"}`);
    return res.status(statusCode).json({ error: message || "bad request" });
  }

  if (isPayloadTooLarge) {
    console.log(`[request-error:413] ${message || "payload too large"}`);
    return res.status(413).json({ error: message || "payload too large" });
  }

  console.error(err);

  return res.status(500).json({ error: "internal server error" });
});

export { app };
