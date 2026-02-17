import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

type FirebasercShape = {
  projects?: {
    default?: string;
  };
};

function readFirebaserc(cwd: string): FirebasercShape {
  const filePath = path.join(cwd, ".firebaserc");
  if (!fs.existsSync(filePath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as FirebasercShape;
  } catch {
    return {};
  }
}

function writeFirebaserc(cwd: string, projectId: string): void {
  const filePath = path.join(cwd, ".firebaserc");
  const current = readFirebaserc(cwd);

  const next: FirebasercShape = {
    ...current,
    projects: {
      ...(current.projects || {}),
      default: projectId
    }
  };

  fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

function runCommand(
  command: string,
  args: string[],
  options?: { allowFailure?: boolean; captureOutput?: boolean }
): { success: boolean; stdout: string; stderr: string } {
  const captureOutput = options?.captureOutput ?? false;
  const result = spawnSync(command, args, {
    shell: true,
    stdio: captureOutput ? "pipe" : "inherit",
    encoding: "utf8"
  });

  const success = result.status === 0;
  const stdout = (result.stdout || "").trim();
  const stderr = (result.stderr || "").trim();

  if (!success && !options?.allowFailure) {
    process.exit(result.status || 1);
  }

  return { success, stdout, stderr };
}

function hasBinary(command: string): boolean {
  const result = runCommand(command, ["--version"], { allowFailure: true, captureOutput: true });
  return result.success;
}

function normalizeYesNo(value: string, defaultValue: boolean): boolean {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return defaultValue;
  }

  return ["y", "yes", "true", "1"].includes(trimmed);
}

async function main(): Promise<void> {
  const cwd = process.cwd();
  const rl = createInterface({ input, output });

  try {
    console.log("\\nSAP Content Server bootstrap installer\\n");

    const requiredBinaries = ["node", "npm", "firebase", "gcloud"];
    const missing = requiredBinaries.filter((binary) => !hasBinary(binary));

    if (missing.length > 0) {
      console.error(`Missing required tools: ${missing.join(", ")}`);
      console.error("Install missing tools and re-run: npm run bootstrap");
      process.exit(1);
    }

    const currentProject = readFirebaserc(cwd).projects?.default || "";
    const projectIdInput = await rl.question(
      `Firebase project id${currentProject ? ` [${currentProject}]` : ""}: `
    );
    const projectId = projectIdInput.trim() || currentProject;
    if (!projectId) {
      console.error("Project id is required.");
      process.exit(1);
    }

    const regionInput = await rl.question("Functions region [us-central1]: ");
    const region = regionInput.trim() || "us-central1";

    const replicateInput = await rl.question("Enable Drive replication [Y/n]: ");
    const replicateToDrive = normalizeYesNo(replicateInput, true);

    let driveFolderId = "";
    let replicateStrict = false;
    let useOAuth = false;
    let driveClientId = "";
    let driveClientSecret = "";
    let driveRefreshToken = "";

    if (replicateToDrive) {
      const driveFolderIdInput = await rl.question("Google Drive root folder ID: ");
      driveFolderId = driveFolderIdInput.trim();
      if (!driveFolderId) {
        console.error("Google Drive root folder ID is required when replication is enabled.");
        process.exit(1);
      }

      const strictInput = await rl.question("Strict replication mode (fail API on Drive error) [y/N]: ");
      replicateStrict = normalizeYesNo(strictInput, false);

      const oauthInput = await rl.question("Configure OAuth user Drive credentials now [y/N]: ");
      useOAuth = normalizeYesNo(oauthInput, false);
      if (useOAuth) {
        driveClientId = (await rl.question("GOOGLE_DRIVE_CLIENT_ID: ")).trim();
        driveClientSecret = (await rl.question("GOOGLE_DRIVE_CLIENT_SECRET: ")).trim();
        driveRefreshToken = (await rl.question("GOOGLE_DRIVE_REFRESH_TOKEN: ")).trim();

        if (!driveClientId || !driveClientSecret || !driveRefreshToken) {
          console.error("OAuth fields are required when OAuth setup is selected.");
          process.exit(1);
        }
      }
    }

    const deployInput = await rl.question("Deploy functions at the end [Y/n]: ");
    const shouldDeploy = normalizeYesNo(deployInput, true);

    console.log("\\nConfiguring Firebase project alias...");
    writeFirebaserc(cwd, projectId);

    console.log("Setting active gcloud project...");
    runCommand("gcloud", ["config", "set", "project", projectId]);

    console.log("Enabling required Google APIs...");
    runCommand("gcloud", [
      "services",
      "enable",
      "cloudfunctions.googleapis.com",
      "cloudbuild.googleapis.com",
      "artifactregistry.googleapis.com",
      "firestore.googleapis.com",
      "firebase.googleapis.com",
      "storage.googleapis.com"
    ]);

    const configArgs: string[] = [];
    if (replicateToDrive) {
      configArgs.push(`app.google_drive_folder_id=${driveFolderId}`);
      configArgs.push("app.replicate_to_drive=true");
      configArgs.push(`app.replicate_to_drive_strict=${replicateStrict ? "true" : "false"}`);

      if (useOAuth) {
        configArgs.push(`app.google_drive_client_id=${driveClientId}`);
        configArgs.push(`app.google_drive_client_secret=${driveClientSecret}`);
        configArgs.push(`app.google_drive_refresh_token=${driveRefreshToken}`);
      }
    } else {
      configArgs.push("app.replicate_to_drive=false");
      configArgs.push("app.replicate_to_drive_strict=false");
    }

    console.log("Applying Firebase runtime config...");
    runCommand("firebase", ["functions:config:set", ...configArgs]);

    if (shouldDeploy) {
      console.log("Deploying Firebase Functions...");
      runCommand("npm", ["run", "deploy:firebase"]);
    }

    const baseUrl = `https://${region}-${projectId}.cloudfunctions.net/api`;
    console.log("\\nBootstrap complete.");
    console.log(`Base URL: ${baseUrl}`);
    console.log(`Health: ${baseUrl}/health`);
    console.log(`Metadata: ${baseUrl}/sap/metadata`);
    console.log(`Raw upload: ${baseUrl}/sap/content/raw`);
    console.log("\\nRun smoke tests with: npm run verify:deployed");
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error("Bootstrap failed:", error);
  process.exit(1);
});
