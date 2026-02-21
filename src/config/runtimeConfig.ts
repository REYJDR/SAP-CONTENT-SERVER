type RuntimeAppConfig = {
  google_drive_folder_id?: string;
  replicate_to_drive?: string;
  replicate_to_drive_strict?: string;
  drive_replication_path_template?: string;
  drive_replication_fo_type_map?: string;
  google_drive_client_id?: string;
  google_drive_client_secret?: string;
  google_drive_refresh_token?: string;
};

type RuntimeConfigShape = {
  app?: RuntimeAppConfig;
};

function readCloudRuntimeConfig(): RuntimeConfigShape {
  const raw = process.env.CLOUD_RUNTIME_CONFIG;
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as RuntimeConfigShape;
  } catch {
    return {};
  }
}

function readFunctionsModuleConfig(): RuntimeConfigShape {
  try {
    const functionsModule = require("firebase-functions/v1") as {
      config?: () => RuntimeConfigShape;
    };

    return functionsModule.config?.() || {};
  } catch {
    return {};
  }
}

export function getRuntimeAppConfig(): RuntimeAppConfig {
  const fromEnv = readCloudRuntimeConfig().app || {};
  const fromFunctions = readFunctionsModuleConfig().app || {};

  return {
    ...fromEnv,
    ...fromFunctions
  };
}
