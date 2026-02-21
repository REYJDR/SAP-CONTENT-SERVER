import dotenv from "dotenv";
import { z } from "zod";

const isCloudFunctionsRuntime = Boolean(process.env.FUNCTION_TARGET) || Boolean(process.env.K_SERVICE);

if (!isCloudFunctionsRuntime) {
  dotenv.config({ path: ".env.local" });
  dotenv.config();
}

type FirebaseRuntimeConfig = {
  app?: {
    google_drive_folder_id?: string;
    replicate_to_drive?: string;
    replicate_to_drive_strict?: string;
    drive_replication_path_template?: string;
    drive_replication_fo_type_map?: string;
    google_drive_client_id?: string;
    google_drive_client_secret?: string;
    google_drive_refresh_token?: string;
    sap_trace_all_requests?: string;
    sap_trace_user_agent?: string;
  };
};

function loadCloudRuntimeConfigEnv(): FirebaseRuntimeConfig {
  const raw = process.env.CLOUD_RUNTIME_CONFIG;
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as FirebaseRuntimeConfig;
  } catch {
    return {};
  }
}

function loadFirebaseRuntimeConfig(): FirebaseRuntimeConfig {
  try {
    const functionsModule = require("firebase-functions/v1") as {
      config?: () => FirebaseRuntimeConfig;
    };
    return functionsModule.config?.() || {};
  } catch {
    return {};
  }
}

const runtimeConfigFromModule = loadFirebaseRuntimeConfig();
const runtimeConfigFromEnv = loadCloudRuntimeConfigEnv();
const runtimeConfig: FirebaseRuntimeConfig = {
  app: {
    ...runtimeConfigFromEnv.app,
    ...runtimeConfigFromModule.app
  }
};
const effectiveEnv: NodeJS.ProcessEnv = {
  ...process.env,
  GOOGLE_DRIVE_FOLDER_ID:
    runtimeConfig.app?.google_drive_folder_id || process.env.GOOGLE_DRIVE_FOLDER_ID || process.env.GOOGLE_DRIVE_FOLDER_ID,
  REPLICATE_TO_DRIVE:
    runtimeConfig.app?.replicate_to_drive || process.env.REPLICATE_TO_DRIVE || process.env.REPLICATE_TO_DRIVE,
  REPLICATE_TO_DRIVE_STRICT:
    runtimeConfig.app?.replicate_to_drive_strict ||
    process.env.REPLICATE_TO_DRIVE_STRICT ||
    process.env.REPLICATE_TO_DRIVE_STRICT,
  DRIVE_REPLICATION_PATH_TEMPLATE:
    runtimeConfig.app?.drive_replication_path_template ||
    process.env.DRIVE_REPLICATION_PATH_TEMPLATE ||
    process.env.DRIVE_REPLICATION_PATH_TEMPLATE,
  DRIVE_REPLICATION_FO_TYPE_MAP:
    runtimeConfig.app?.drive_replication_fo_type_map ||
    process.env.DRIVE_REPLICATION_FO_TYPE_MAP ||
    process.env.DRIVE_REPLICATION_FO_TYPE_MAP,
  GOOGLE_DRIVE_CLIENT_ID:
    runtimeConfig.app?.google_drive_client_id || process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_DRIVE_CLIENT_ID,
  GOOGLE_DRIVE_CLIENT_SECRET:
    runtimeConfig.app?.google_drive_client_secret ||
    process.env.GOOGLE_DRIVE_CLIENT_SECRET ||
    process.env.GOOGLE_DRIVE_CLIENT_SECRET,
  GOOGLE_DRIVE_REFRESH_TOKEN:
    runtimeConfig.app?.google_drive_refresh_token ||
    process.env.GOOGLE_DRIVE_REFRESH_TOKEN ||
    process.env.GOOGLE_DRIVE_REFRESH_TOKEN,
  SAP_TRACE_ALL_REQUESTS:
    runtimeConfig.app?.sap_trace_all_requests || process.env.SAP_TRACE_ALL_REQUESTS || process.env.SAP_TRACE_ALL_REQUESTS,
  SAP_TRACE_USER_AGENT:
    runtimeConfig.app?.sap_trace_user_agent || process.env.SAP_TRACE_USER_AGENT || process.env.SAP_TRACE_USER_AGENT
};

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value === "string") {
    return value.toLowerCase() === "true";
  }

  return value;
}, z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(8080),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().max(512).default(25),
  STORAGE_BACKEND: z.enum(["gcs", "drive"]).default("gcs"),
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  STORAGE_BUCKET: z.string().optional(),
  FIREBASE_STORAGE_BUCKET: z.string().optional(),
  GOOGLE_DRIVE_FOLDER_ID: z.string().optional(),
  GOOGLE_DRIVE_CLIENT_ID: z.string().optional(),
  GOOGLE_DRIVE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_DRIVE_REFRESH_TOKEN: z.string().optional(),
  DRIVE_REPLICATION_PATH_TEMPLATE: z.string().default("{foType}/{foId}/Attachment"),
  DRIVE_REPLICATION_FO_TYPE_MAP: z.string().default("{}"),
  SAP_TRACE_ALL_REQUESTS: booleanFromEnv.default(false),
  SAP_TRACE_USER_AGENT: z.string().default("SAP NetWeaver Application Server"),
  REPLICATE_TO_DRIVE: booleanFromEnv.default(false),
  REPLICATE_TO_DRIVE_STRICT: booleanFromEnv.default(false)
});

const parsed = envSchema.safeParse(effectiveEnv);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
