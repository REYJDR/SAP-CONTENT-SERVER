import { randomUUID } from "crypto";
import Busboy from "busboy";
import express from "express";
import { env } from "../config/env";
import { getRuntimeAppConfig } from "../config/runtimeConfig";
import { deleteDocument, upsertDocument } from "../repository/documentRepository";
import { DriveReplicationService } from "../services/driveReplicationService";
import { FirebaseStorageService } from "../services/firebaseStorageService";
import { createStorageAdapter } from "../storage";

const router = express.Router();
const storageAdapter = createStorageAdapter();
const firebaseStorageService = new FirebaseStorageService();
const driveReplicationService = new DriveReplicationService();
const rawUpload = express.raw({ type: "*/*", limit: "25mb" });
const shouldPersistMetadata = env.STORAGE_BACKEND === "drive";

const attachmentSourceHints = [
  "attachmentSource",
  "source",
  "sourceType",
  "businessObject",
  "businessObjectType",
  "boType",
  "objectType",
  "classname",
  "className",
  "sapObjectType",
  "borObjectType"
];

const sourceLocationHints = ["sourceLocation", "sourceLoc", "sour_loc", "source", "fromLoc", "originLoc"];
const destinationLocationHints = [
  "destinationLocation",
  "destinationLoc",
  "dest_loc",
  "destination",
  "toLoc",
  "targetLoc"
];

function parseFlag(value: string | boolean | undefined): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  return typeof value === "string" && value.toLowerCase() === "true";
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickRawValueByKeys(source: Record<string, unknown> | undefined, keys: string[]): unknown {
  if (!source) {
    return undefined;
  }

  const normalizedEntries = Object.entries(source).map(([key, value]) => [key.toLowerCase(), value] as const);
  for (const key of keys) {
    const entry = normalizedEntries.find(([normalizedKey]) => normalizedKey === key.toLowerCase());
    if (entry) {
      return entry[1];
    }
  }

  return undefined;
}

function toSourceFolderSegment(rawValue: string): string | undefined {
  const value = rawValue.trim();
  if (!value) {
    return undefined;
  }

  const upperValue = value.toUpperCase();
  if (upperValue.includes("/SCMTMS/TOR") || upperValue.includes("FREIGHT") || upperValue.includes("FREIGHTORDER")) {
    return "freight-order";
  }

  const normalized = value
    .replace(/^\/+/, "")
    .replace(/\//g, "-")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .toLowerCase();

  return normalized || undefined;
}

function pickValueByKeys(
  source: Record<string, unknown> | undefined,
  keys: string[]
): string | undefined {
  if (!source) {
    return undefined;
  }

  const normalizedEntries = Object.entries(source).map(([key, value]) => [key.toLowerCase(), value] as const);

  for (const key of keys) {
    const entry = normalizedEntries.find(([normalizedKey]) => normalizedKey === key.toLowerCase());
    if (!entry) {
      continue;
    }

    const value = entry[1];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}

function pickAttachmentSource(
  req: express.Request,
  multipartFields?: Record<string, string>
): string | undefined {
  const querySource = req.query as Record<string, unknown>;
  const bodySource = req.body as Record<string, unknown> | undefined;
  const multipartSource = multipartFields as Record<string, unknown> | undefined;
  const headerSource = pickValueByKeys(
    {
      "x-attachment-source": req.header("x-attachment-source"),
      "x-sap-object-type": req.header("x-sap-object-type")
    },
    ["x-attachment-source", "x-sap-object-type"]
  );

  const raw =
    pickValueByKeys(querySource, attachmentSourceHints) ||
    pickValueByKeys(bodySource, attachmentSourceHints) ||
    pickValueByKeys(multipartSource, attachmentSourceHints) ||
    headerSource;

  if (!raw) {
    return undefined;
  }

  return toSourceFolderSegment(raw);
}

async function resolveAttachmentSource(
  req: express.Request,
  documentId: string,
  multipartFields?: Record<string, string>
): Promise<string | undefined> {
  const directSource = pickAttachmentSource(req, multipartFields);
  if (directSource) {
    return directSource;
  }

  const metadata = await firebaseStorageService.getDocumentMetadata(documentId);
  if (!metadata?.attachmentSource) {
    return undefined;
  }

  return toSourceFolderSegment(metadata.attachmentSource);
}

function shouldReplicateToDriveNow(): boolean {
  if (env.STORAGE_BACKEND !== "gcs") {
    return false;
  }

  const runtimeAppConfig = getRuntimeAppConfig();
  return parseFlag(runtimeAppConfig.replicate_to_drive) || env.REPLICATE_TO_DRIVE;
}

function isReplicationStrictNow(): boolean {
  const runtimeAppConfig = getRuntimeAppConfig();
  return parseFlag(runtimeAppConfig.replicate_to_drive_strict) || env.REPLICATE_TO_DRIVE_STRICT;
}

function sendSapServerInfo(res: express.Response): express.Response {
  const payload = [
    "server=SAP-CONTENT-SERVER",
    "serverVersion=1.0",
    "serverBuild=2026-02-14",
    `backend=${env.STORAGE_BACKEND}`,
    "capabilities=PING,SERVERINFO,PUT,GET,DELETE"
  ].join("\n");

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  return res.status(200).send(payload);
}

function truncateLogValue(value: unknown, maxLength = 220): unknown {
  if (typeof value !== "string") {
    return value;
  }

  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...[truncated:${value.length}]`;
}

function compactQueryForLog(query: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = new Set(["seckey", "authid", "signature", "token", "authorization"]);

  return Object.fromEntries(
    Object.entries(query).map(([key, value]) => {
      const keyLower = key.toLowerCase();
      const valueAsString = Array.isArray(value) ? value.join(",") : String(value ?? "");

      if (sensitiveKeys.has(keyLower)) {
        return [key, `[REDACTED:${valueAsString.length}]`];
      }

      return [key, truncateLogValue(valueAsString)];
    })
  );
}

function pickRequestHeadersForLog(req: express.Request): Record<string, string | undefined> {
  return {
    host: req.header("host") || undefined,
    userAgent: req.header("user-agent") || undefined,
    contentType: req.header("content-type") || undefined,
    contentLength: req.header("content-length") || undefined,
    forwardedFor: req.header("x-forwarded-for") || undefined,
    forwardedProto: req.header("x-forwarded-proto") || undefined,
    requestId: req.header("x-request-id") || req.header("x-correlation-id") || undefined
  };
}

function logSapRequestLine(
  tag: "[SAP-CS-REQUEST]" | "[SAP-CS-MULTIPART]",
  req: express.Request,
  extra?: Record<string, unknown>
): void {
  const rawQuery = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?") + 1) : "";

  console.log(
    `${tag} ${JSON.stringify({
      method: req.method,
      path: req.path,
      originalUrl: req.originalUrl,
      rawQueryLength: rawQuery.length,
      query: compactQueryForLog(req.query as Record<string, unknown>),
      headers: pickRequestHeadersForLog(req),
      extra: extra
        ? Object.fromEntries(Object.entries(extra).map(([key, value]) => [key, truncateLogValue(value)]))
        : undefined
    })}`
  );
}

function logDeleteRequest(
  req: express.Request,
  source: "ContentServer.GET" | "ContentServer.POST" | "ContentServer.PUT" | "ContentServer.DELETE" | "sap/content/:documentId",
  documentId: string,
  action?: "SERVERINFO" | "GET" | "DELETE" | null
): void {
  const incomingRequestId =
    req.header("x-request-id") || req.header("x-correlation-id") || req.header("x-sap-request-id");
  const requestId = incomingRequestId || randomUUID();
  const cmd = String(req.query.cmd || req.query.command || "").toUpperCase() || undefined;
  const accessMode = String(req.query.accessMode || req.query.accessmode || "").toLowerCase() || undefined;

  req.res?.setHeader("x-request-id", requestId);

  console.log("[SAP-DELETE]", {
    requestId,
    source,
    method: req.method,
    path: req.path,
    action,
    cmd,
    accessMode,
    documentId
  });
}

function getOrCreateRequestId(req: express.Request): string {
  return (
    req.header("x-request-id") || req.header("x-correlation-id") || req.header("x-sap-request-id") || randomUUID()
  );
}

async function replicateToDriveIfEnabled(
  documentId: string,
  contentType: string,
  bytes: Buffer
): Promise<boolean> {
  if (!shouldReplicateToDriveNow()) {
    return false;
  }

  const metadata = await firebaseStorageService.getDocumentMetadata(documentId);
  if (!metadata) {
    return false;
  }

  const businessObjectType = metadata.businessObjectType?.trim();
  const businessObjectId = metadata.businessObjectId?.trim();
  const originalFileName = metadata.originalFileName?.trim();
  const sourceLocation = metadata.sourceLocation?.trim();
  const destinationLocation = metadata.destinationLocation?.trim();

  if (!businessObjectType || !businessObjectId || !originalFileName) {
    console.log(
      `[SAP-DRIVE-REPLICATION-SKIPPED] ${JSON.stringify({
        documentId,
        reason: "missing required metadata fields",
        businessObjectType: Boolean(businessObjectType),
        businessObjectId: Boolean(businessObjectId),
        originalFileName: Boolean(originalFileName)
      })}`
    );
    return false;
  }

  try {
    await driveReplicationService.replicate(documentId, originalFileName, contentType, bytes, {
      businessObjectType,
      businessObjectId,
      sourceLocation,
      destinationLocation
    });
    return true;
  } catch (error) {
    if (isReplicationStrictNow()) {
      throw error;
    }

    console.error("Drive replication failed:", error);
    return false;
  }
}

interface ParsedMetadataItem {
  raw: Record<string, unknown>;
  documentId?: string;
  businessObjectType?: string;
  businessObjectId?: string;
  sourceLocation?: string;
  destinationLocation?: string;
  originalFileName?: string;
  sourceSystem?: string;
  attachmentSource?: string;
  attributes?: Record<string, string>;
}

function parseMetadataItems(input: unknown): { items: ParsedMetadataItem[]; batchMode: boolean } {
  let rawItems: Record<string, unknown>[] = [];
  let batchMode = false;

  if (Array.isArray(input)) {
    rawItems = input.filter(isObjectRecord);
    batchMode = true;
  } else if (isObjectRecord(input)) {
    const maybeDocuments = pickRawValueByKeys(input, ["documents"]);
    const maybeItems = pickRawValueByKeys(input, ["items"]);

    if (Array.isArray(maybeDocuments)) {
      rawItems = maybeDocuments.filter(isObjectRecord);
      batchMode = true;
    } else if (Array.isArray(maybeItems)) {
      rawItems = maybeItems.filter(isObjectRecord);
      batchMode = true;
    } else {
      rawItems = [input];
    }
  }

  const items = rawItems.map((raw) => {
    const rawAttributesValue = pickRawValueByKeys(raw, ["attributes"]);
    const rawAttributes = isObjectRecord(rawAttributesValue) ? rawAttributesValue : undefined;
    const attributes = rawAttributes
      ? Object.fromEntries(Object.entries(rawAttributes).map(([key, value]) => [key, String(value ?? "")]))
      : undefined;
    const sourceLocation =
      readString(pickRawValueByKeys(raw, ["sourceLocation", "sourceLoc", "sour_loc"])) ||
      pickValueByKeys(rawAttributes, sourceLocationHints);
    const destinationLocation =
      readString(pickRawValueByKeys(raw, ["destinationLocation", "destinationLoc", "dest_loc"])) ||
      pickValueByKeys(rawAttributes, destinationLocationHints);

    return {
      raw,
      documentId: readString(pickRawValueByKeys(raw, ["documentId", "docId"])),
      businessObjectType: readString(pickRawValueByKeys(raw, ["businessObjectType"])),
      businessObjectId: readString(pickRawValueByKeys(raw, ["businessObjectId"])),
      sourceLocation,
      destinationLocation,
      originalFileName: readString(pickRawValueByKeys(raw, ["originalFileName", "fileName"])),
      sourceSystem: readString(pickRawValueByKeys(raw, ["sourceSystem"])),
      attachmentSource:
        readString(pickRawValueByKeys(raw, ["attachmentSource"])) ||
        readString(pickRawValueByKeys(raw, ["businessObjectType"])),
      attributes
    };
  });

  return { items, batchMode };
}

async function replicateStoredDocumentToDriveIfEnabled(documentId: string): Promise<boolean> {
  if (!shouldReplicateToDriveNow()) {
    return false;
  }

  const payload = await storageAdapter.get(documentId);
  if (!payload) {
    return false;
  }

  return replicateToDriveIfEnabled(documentId, payload.contentType, payload.bytes);
}

async function deleteDriveReplicasIfEnabled(documentId: string): Promise<void> {
  if (!shouldReplicateToDriveNow()) {
    return;
  }

  try {
    await driveReplicationService.deleteReplicas(documentId);
  } catch (error) {
    if (isReplicationStrictNow()) {
      throw error;
    }

    console.error("Drive replica deletion failed:", error);
  }
}

type UploadedFile = {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
};

type ParsedMultipart = {
  file: UploadedFile | null;
  fields: Record<string, string>;
};

async function parseMultipart(req: express.Request): Promise<ParsedMultipart> {
  const contentType = req.headers["content-type"];
  if (!contentType || !contentType.includes("multipart/form-data")) {
    throw new Error("multipart/form-data content-type is required");
  }

  const fields: Record<string, string> = {};
  let file: UploadedFile | null = null;

  await new Promise<void>((resolve, reject) => {
    const busboy = Busboy({ headers: req.headers });

    busboy.on("field", (name, value) => {
      fields[name] = value;
    });

    busboy.on("file", (_fieldName, stream, info) => {
      const chunks: Buffer[] = [];

      stream.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });

      stream.on("error", reject);

      stream.on("end", () => {
        file = {
          originalname: info.filename || "upload.bin",
          mimetype: info.mimeType || "application/octet-stream",
          buffer: Buffer.concat(chunks)
        };
      });
    });

    busboy.on("error", reject);
    busboy.on("finish", resolve);

    const rawBody = (req as express.Request & { rawBody?: Buffer }).rawBody;
    if (Buffer.isBuffer(rawBody) && rawBody.length > 0) {
      busboy.end(rawBody);
    } else {
      req.pipe(busboy);
    }
  });

  return { file, fields };
}

function pickDocumentId(req: express.Request): string | undefined {
  const querySource = req.query as Record<string, unknown>;
  const bodySource = req.body as Record<string, unknown> | undefined;

  const commonKeys = [
    "docId",
    "documentId",
    "sapwdresourceid",
    "sapWdResourceId",
    "sap-wd-resource-id",
    "objectId",
    "object_id",
    "phioId",
    "phio_id"
  ];

  const queryValue = pickValueByKeys(querySource, commonKeys);
  if (queryValue) {
    return queryValue;
  }

  const bodyValue = pickValueByKeys(bodySource, commonKeys);
  if (bodyValue) {
    return bodyValue;
  }

  return (
    (req.params?.docId as string | undefined) ||
    (req.params?.documentId as string | undefined)
  );
}

function extractRawQuery(req: express.Request): string {
  const originalUrl = req.originalUrl || "";
  const questionMarkIndex = originalUrl.indexOf("?");
  if (questionMarkIndex < 0) {
    return "";
  }

  return originalUrl.slice(questionMarkIndex + 1);
}

function extractRawQueryTokens(req: express.Request): string[] {
  const rawQuery = extractRawQuery(req);
  if (!rawQuery) {
    return [];
  }

  return rawQuery
    .split(/[&?]/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .map((token) => token.toLowerCase());
}

function normalizeCmdValue(value: string): string {
  return value.split(/[?&]/)[0]?.trim().toUpperCase() || "";
}

function resolveSapContentAction(req: express.Request): "SERVERINFO" | "GET" | "DELETE" | null {
  const cmd = normalizeCmdValue(String(req.query.cmd || req.query.command || ""));
  const rawTokens = extractRawQueryTokens(req);
  const rawCmdToken = rawTokens.find((token) => token.startsWith("cmd=") || token.startsWith("command="));
  const rawCmd = rawCmdToken ? normalizeCmdValue(rawCmdToken.split("=").slice(1).join("=")) : "";
  const effectiveCmd = cmd || rawCmd;

  if (["GET", "READ"].includes(effectiveCmd)) {
    return "GET";
  }

  if (["DELETE", "DEL", "REMOVE", "DELETECOMP", "DELETECONTENT"].includes(effectiveCmd)) {
    return "DELETE";
  }

  if (effectiveCmd === "PING" || effectiveCmd === "SERVERINFO") {
    return "SERVERINFO";
  }

  const queryKeys = Object.keys(req.query).map((key) => key.toLowerCase());
  const hasServerInfoFlag = queryKeys.includes("serverinfo") || rawTokens.includes("serverinfo");
  const hasPingFlag = queryKeys.includes("ping") || rawTokens.includes("ping");
  const hasDeleteFlag = ["delete", "del", "remove", "deletecomp", "deletecontent"].some((flag) =>
    queryKeys.includes(flag) || rawTokens.includes(flag)
  );
  if (hasServerInfoFlag || hasPingFlag) {
    return "SERVERINFO";
  }

  const hasInfoFlag = "info" in req.query || "INFO" in req.query || rawTokens.includes("info");
  const documentId = pickDocumentId(req);
  const accessMode = String(req.query.accessMode || req.query.accessmode || "").toLowerCase();

  if (hasInfoFlag && !documentId) {
    return "SERVERINFO";
  }

  if (documentId) {
    if (hasDeleteFlag || ["d", "delete", "x", "del", "remove"].includes(accessMode)) {
      return "DELETE";
    }

    if (hasInfoFlag || ["", "r", "read", "display"].includes(accessMode)) {
      return "GET";
    }
  }

  return null;
}

async function streamDocument(
  documentId: string,
  res: express.Response,
  options?: { notFoundStatus?: number; notFoundBody?: string }
): Promise<boolean> {
  const payload = await storageAdapter.get(documentId);
  if (!payload) {
    const notFoundStatus = options?.notFoundStatus ?? 404;
    const notFoundBody = options?.notFoundBody;

    if (typeof notFoundBody === "string") {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.status(notFoundStatus).send(notFoundBody);
    } else {
      res.status(notFoundStatus).json({ error: "document blob not found" });
    }
    return false;
  }

  res.setHeader("Content-Type", payload.contentType);
  res.setHeader("Content-Disposition", `inline; filename=\"${payload.fileName}\"`);
  res.send(payload.bytes);
  return true;
}

router.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    backend: env.STORAGE_BACKEND,
    replicateToDrive: shouldReplicateToDriveNow()
  });
});

router.get("/health/storage", async (_req, res) => {
  if (env.STORAGE_BACKEND !== "gcs") {
    return res.status(200).json({
      status: "skipped",
      backend: env.STORAGE_BACKEND,
      reason: "storage probe is currently implemented for gcs backend"
    });
  }

  const probeId = `health-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const probeFileName = "storage-health.txt";
  const probeContentType = "text/plain";
  const probePayload = Buffer.from(`storage-health-${new Date().toISOString()}`, "utf8");

  try {
    await firebaseStorageService.upload(probeId, probeFileName, probePayload, probeContentType);
    const downloaded = await firebaseStorageService.downloadByDocumentId(probeId);
    const isMatch = downloaded
      ? downloaded.contentType === probeContentType &&
        downloaded.fileName === probeFileName &&
        downloaded.bytes.equals(probePayload)
      : false;

    await firebaseStorageService.removeByDocumentId(probeId);

    if (!isMatch) {
      return res.status(500).json({
        status: "error",
        backend: env.STORAGE_BACKEND,
        bucket: firebaseStorageService.getBucketName(),
        message: "storage probe mismatch"
      });
    }

    return res.status(200).json({
      status: "ok",
      backend: env.STORAGE_BACKEND,
      bucket: firebaseStorageService.getBucketName()
    });
  } catch (error) {
    try {
      await firebaseStorageService.removeByDocumentId(probeId);
    } catch {
      // best-effort cleanup
    }

    return res.status(500).json({
      status: "error",
      backend: env.STORAGE_BACKEND,
      bucket: env.FIREBASE_STORAGE_BUCKET || "unknown",
      message: error instanceof Error ? error.message : "storage probe failed"
    });
  }
});

router.get("/health/drive-replication", async (_req, res) => {
  if (!shouldReplicateToDriveNow()) {
    return res.status(200).json({
      status: "skipped",
      backend: env.STORAGE_BACKEND,
      replicateToDrive: shouldReplicateToDriveNow(),
      reason: "drive replication is not enabled"
    });
  }

  try {
    const diagnosis = await driveReplicationService.diagnoseFolder();
    return res.status(200).json({
      status: "ok",
      backend: env.STORAGE_BACKEND,
      replicateToDrive: shouldReplicateToDriveNow(),
      diagnosis
    });
  } catch (error) {
    return res.status(500).json({
      status: "error",
      backend: env.STORAGE_BACKEND,
      replicateToDrive: shouldReplicateToDriveNow(),
      folderId: (() => {
        try {
          return driveReplicationService.getConfiguredFolderId();
        } catch {
          return "unknown";
        }
      })(),
      message: error instanceof Error ? error.message : "drive diagnosis failed"
    });
  }
});

router.all("/ContentServer/ContentServer.dll", (req, _res, next) => {
  const rawQuery = req.originalUrl.includes("?") ? req.originalUrl.split("?")[1] : "";
  const action = resolveSapContentAction(req);
  const documentId = pickDocumentId(req);

  req.res?.setHeader("x-sap-debug-method", req.method);
  req.res?.setHeader("x-sap-debug-action", action || "NONE");
  req.res?.setHeader("x-sap-debug-docid", documentId || "NONE");
  req.res?.setHeader("x-sap-debug-query", rawQuery ? encodeURIComponent(rawQuery).slice(0, 512) : "NONE");

  console.log(
    `[SAP-CS-INBOUND] ${JSON.stringify({
      method: req.method,
      path: req.path,
      originalUrl: req.originalUrl,
      action,
      documentId,
      query: req.query,
      contentType: req.header("content-type") || undefined,
      userAgent: req.header("user-agent") || undefined,
      forwardedFor: req.header("x-forwarded-for") || undefined
    })}`
  );

  logSapRequestLine("[SAP-CS-REQUEST]", req);

  return next();
});

router.get("/ContentServer/ContentServer.dll", async (req, res, next) => {
  try {
    const action = resolveSapContentAction(req);

    if (!action || action === "SERVERINFO") {
      return sendSapServerInfo(res);
    }

    if (action === "GET") {
      const documentId = pickDocumentId(req);
      if (!documentId) {
        return res.status(400).json({ error: "docId or documentId is required" });
      }
      await streamDocument(documentId, res, {
        notFoundStatus: 200,
        notFoundBody: "document not found"
      });
      return;
    }

    if (action === "DELETE") {
      const documentId = pickDocumentId(req);
      if (!documentId) {
        console.log(
          `[SAP-DELETE-PROBE] ${JSON.stringify({
            source: "ContentServer.GET",
            method: req.method,
            path: req.path,
            originalUrl: req.originalUrl,
            message: "DELETE command received without document id; returning server capabilities"
          })}`
        );
        return sendSapServerInfo(res);
      }

      logDeleteRequest(req, "ContentServer.GET", documentId, action);

      await storageAdapter.remove(documentId);
      await deleteDriveReplicasIfEnabled(documentId);
      if (shouldPersistMetadata) {
        await deleteDocument(documentId);
      }
      return res.status(204).send();
    }

    return res.status(400).json({ error: "Unsupported ContentServer action" });
  } catch (error) {
    return next(error);
  }
});

router.delete("/ContentServer/ContentServer.dll", async (req, res, next) => {
  try {
    const documentId = pickDocumentId(req);
    if (!documentId) {
      return res.status(400).json({ error: "docId or documentId is required" });
    }

    logDeleteRequest(req, "ContentServer.DELETE", documentId, "DELETE");

    await storageAdapter.remove(documentId);
    await deleteDriveReplicasIfEnabled(documentId);
    if (shouldPersistMetadata) {
      await deleteDocument(documentId);
    }

    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

router.post("/ContentServer/ContentServer.dll", async (req, res, next) => {
  try {
    const action = resolveSapContentAction(req);

    if (action === "SERVERINFO") {
      return sendSapServerInfo(res);
    }

    if (action === "DELETE") {
      const documentId = pickDocumentId(req);
      if (!documentId) {
        console.log(
          `[SAP-DELETE-PROBE] ${JSON.stringify({
            source: "ContentServer.POST",
            method: req.method,
            path: req.path,
            originalUrl: req.originalUrl,
            message: "DELETE command received without document id; returning server capabilities"
          })}`
        );
        return sendSapServerInfo(res);
      }

      logDeleteRequest(req, "ContentServer.PUT", documentId, action);

      await storageAdapter.remove(documentId);
      await deleteDriveReplicasIfEnabled(documentId);
      if (shouldPersistMetadata) {
        await deleteDocument(documentId);
      }
      return res.status(204).send();
    }

    const parsed = await parseMultipart(req);
    logSapRequestLine("[SAP-CS-MULTIPART]", req, {
      fields: parsed.fields,
      fileName: parsed.file?.originalname,
      fileMimeType: parsed.file?.mimetype,
      fileSize: parsed.file?.buffer.length
    });

    const cmd = String(req.query.cmd || req.query.command || parsed.fields.cmd || "PUT").toUpperCase();
    if (!["PUT", "CREATE"].includes(cmd)) {
      return res.status(400).json({ error: `Unsupported cmd for POST: ${cmd}` });
    }

    if (!parsed.file) {
      return res.status(400).json({ error: "file is required in multipart/form-data" });
    }

    const documentId =
      (req.query.docId as string | undefined) ||
      (req.query.documentId as string | undefined) ||
      parsed.fields.docId ||
      parsed.fields.documentId ||
      randomUUID();
    const contentType = parsed.file.mimetype || "application/octet-stream";
    const attachmentSource = await resolveAttachmentSource(req, documentId, parsed.fields);

    const putResult = await storageAdapter.put({
      documentId,
      fileName: parsed.file.originalname,
      contentType,
      bytes: parsed.file.buffer,
      attachmentSource
    });

    const replicatedToDrive = await replicateToDriveIfEnabled(documentId, contentType, parsed.file.buffer);

    if (shouldPersistMetadata) {
      await upsertDocument({
        id: documentId,
        backend: env.STORAGE_BACKEND,
        attachmentSource,
        fileName: parsed.file.originalname,
        contentType,
        size: putResult.size,
        storagePath: putResult.storagePath,
        driveFileId: putResult.driveFileId
      });
    }

    return res.status(201).json({
      documentId,
      backend: env.STORAGE_BACKEND,
      size: putResult.size,
      replicatedToDrive
    });
  } catch (error) {
    return next(error);
  }
});

router.put("/ContentServer/ContentServer.dll", async (req, res, next) => {
  try {
    const queryKeys = Object.keys(req.query).map((key) => key.toLowerCase());
    const isAdminContRep = queryKeys.includes("admincontrep");
    const operation = String(req.query.operation || "").toLowerCase();

    if (isAdminContRep) {
      console.log(
        `[SAP-CS-ADMIN] ${JSON.stringify({
          method: req.method,
          path: req.path,
          originalUrl: req.originalUrl,
          operation: operation || undefined,
          contRep: (req.query.contRep as string | undefined) || (req.query.contrep as string | undefined),
          userAgent: req.header("user-agent") || undefined,
          forwardedFor: req.header("x-forwarded-for") || undefined
        })}`
      );

      return sendSapServerInfo(res);
    }

    const action = resolveSapContentAction(req);
    if (!action || action === "SERVERINFO") {
      return sendSapServerInfo(res);
    }

    if (action === "DELETE") {
      const documentId = pickDocumentId(req);
      if (!documentId) {
        return sendSapServerInfo(res);
      }

      logDeleteRequest(req, "ContentServer.POST", documentId, action);
      await storageAdapter.remove(documentId);
      await deleteDriveReplicasIfEnabled(documentId);
      if (shouldPersistMetadata) {
        await deleteDocument(documentId);
      }
      return res.status(204).send();
    }

    return res.status(400).json({ error: "Unsupported cmd for PUT" });
  } catch (error) {
    return next(error);
  }
});

router.post("/sap/metadata", async (req, res, next) => {
  try {
    const requestId = getOrCreateRequestId(req);
    res.setHeader("x-request-id", requestId);

    const parsed = parseMetadataItems(req.body);
    if (parsed.items.length === 0) {
      return res
        .status(400)
        .json({ requestId, error: "payload must be an object, an array, or include documents[]" });
    }

    const results: Array<Record<string, unknown>> = [];
    const errors: Array<Record<string, unknown>> = [];

    for (const item of parsed.items) {
      const documentId = item.documentId;
      if (!documentId) {
        errors.push({
          documentId: null,
          error: "documentId or docId is required",
          requestId
        });
        continue;
      }

      if (shouldReplicateToDriveNow() && (!item.businessObjectType || !item.businessObjectId || !item.originalFileName)) {
        errors.push({
          documentId,
          error:
            "businessObjectType, businessObjectId and originalFileName (or fileName) are required when drive replication is enabled",
          requestId
        });
        continue;
      }

      try {
        const metadata = await firebaseStorageService.upsertDocumentMetadata(documentId, {
          businessObjectType: item.businessObjectType,
          businessObjectId: item.businessObjectId,
          sourceLocation: item.sourceLocation,
          destinationLocation: item.destinationLocation,
          originalFileName: item.originalFileName,
          sourceSystem: item.sourceSystem,
          attachmentSource: item.attachmentSource,
          attributes: item.attributes
        });

        const replicatedToDrive = await replicateStoredDocumentToDriveIfEnabled(documentId);

        console.log(
          `[SAP-METADATA] ${JSON.stringify({
            action: "upsert",
            requestId,
            documentId,
            businessObjectType: metadata.businessObjectType,
            businessObjectId: metadata.businessObjectId,
            sourceLocation: metadata.sourceLocation,
            destinationLocation: metadata.destinationLocation,
            originalFileName: metadata.originalFileName,
            attachmentSource: metadata.attachmentSource,
            sourceSystem: metadata.sourceSystem,
            replicatedToDrive
          })}`
        );

        results.push({ documentId, metadata, replicatedToDrive, requestId });
      } catch (error) {
        errors.push({
          documentId,
          error: error instanceof Error ? error.message : "unexpected error",
          requestId
        });
      }
    }

    if (!parsed.batchMode && parsed.items.length === 1 && errors.length === 0 && results.length === 1) {
      return res.status(200).json(results[0]);
    }

    const status = errors.length > 0 ? 207 : 200;
    return res.status(status).json({
      requestId,
      totalReceived: parsed.items.length,
      totalSucceeded: results.length,
      totalFailed: errors.length,
      results,
      errors
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/sap/metadata/:documentId", async (req, res, next) => {
  try {
    const { documentId } = req.params;
    const metadata = await firebaseStorageService.getDocumentMetadata(documentId);
    if (!metadata) {
      return res.status(404).json({ error: "metadata not found" });
    }

    return res.status(200).json({ documentId, metadata });
  } catch (error) {
    return next(error);
  }
});

router.post("/sap/content", async (req, res, next) => {
  try {
    const parsed = await parseMultipart(req);

    if (!parsed.file) {
      return res.status(400).json({ error: "file is required in multipart/form-data" });
    }

    const documentId = parsed.fields.documentId || randomUUID();
    const contentType = parsed.file.mimetype || "application/octet-stream";
    const attachmentSource = await resolveAttachmentSource(req, documentId, parsed.fields);

    const putResult = await storageAdapter.put({
      documentId,
      fileName: parsed.file.originalname,
      contentType,
      bytes: parsed.file.buffer,
      attachmentSource
    });

    const replicatedToDrive = await replicateToDriveIfEnabled(documentId, contentType, parsed.file.buffer);

    if (shouldPersistMetadata) {
      await upsertDocument({
        id: documentId,
        backend: env.STORAGE_BACKEND,
        attachmentSource,
        fileName: parsed.file.originalname,
        contentType,
        size: putResult.size,
        storagePath: putResult.storagePath,
        driveFileId: putResult.driveFileId
      });
    }

    return res.status(201).json({
      documentId,
      backend: env.STORAGE_BACKEND,
      size: putResult.size,
      replicatedToDrive
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/sap/content/raw", rawUpload, async (req, res, next) => {
  try {
    const bytes = Buffer.isBuffer(req.body)
      ? (req.body as Buffer)
      : Buffer.isBuffer((req as express.Request & { rawBody?: Buffer }).rawBody)
        ? (req as express.Request & { rawBody?: Buffer }).rawBody!
        : null;
    if (!bytes || !Buffer.isBuffer(bytes) || bytes.length === 0) {
      return res.status(400).json({ error: "raw request body is required" });
    }

    const documentId =
      (req.query.documentId as string | undefined) ||
      (req.header("x-document-id") as string | undefined) ||
      randomUUID();
    const fileName =
      (req.query.fileName as string | undefined) ||
      (req.header("x-file-name") as string | undefined) ||
      `${documentId}.bin`;
    const contentType = req.header("content-type") || "application/octet-stream";
    const attachmentSource = await resolveAttachmentSource(req, documentId);

    const putResult = await storageAdapter.put({
      documentId,
      fileName,
      contentType,
      bytes,
      attachmentSource
    });

    const replicatedToDrive = await replicateToDriveIfEnabled(documentId, contentType, bytes);

    if (shouldPersistMetadata) {
      await upsertDocument({
        id: documentId,
        backend: env.STORAGE_BACKEND,
        attachmentSource,
        fileName,
        contentType,
        size: putResult.size,
        storagePath: putResult.storagePath,
        driveFileId: putResult.driveFileId
      });
    }

    return res.status(201).json({
      documentId,
      backend: env.STORAGE_BACKEND,
      size: putResult.size,
      replicatedToDrive
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/sap/content/:documentId", async (req, res, next) => {
  try {
    const { documentId } = req.params;
    await streamDocument(documentId, res);
    return;
  } catch (error) {
    return next(error);
  }
});

router.delete("/sap/content/:documentId", async (req, res, next) => {
  try {
    const { documentId } = req.params;
    logDeleteRequest(req, "sap/content/:documentId", documentId, "DELETE");
    await storageAdapter.remove(documentId);
    await deleteDriveReplicasIfEnabled(documentId);
    if (shouldPersistMetadata) {
      await deleteDocument(documentId);
    }
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

export { router as contentRoutes };
