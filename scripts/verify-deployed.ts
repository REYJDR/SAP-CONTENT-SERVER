import fs from "node:fs";
import path from "node:path";

type FirebasercShape = {
  projects?: {
    default?: string;
  };
};

function readDefaultProjectId(cwd: string): string | undefined {
  const filePath = path.join(cwd, ".firebaserc");
  if (!fs.existsSync(filePath)) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as FirebasercShape;
    return parsed.projects?.default;
  } catch {
    return undefined;
  }
}

function readArg(name: string): string | undefined {
  const idx = process.argv.findIndex((arg) => arg === `--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) {
    return process.argv[idx + 1];
  }

  const prefixed = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (!prefixed) {
    return undefined;
  }

  return prefixed.slice(name.length + 3);
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

async function main(): Promise<void> {
  const projectId = readArg("project") || readDefaultProjectId(process.cwd());
  const region = readArg("region") || "us-central1";
  const explicitBaseUrl = readArg("base-url");

  const baseUrl = explicitBaseUrl || (projectId ? `https://${region}-${projectId}.cloudfunctions.net/api` : "");
  if (!baseUrl) {
    console.error("Missing base URL. Provide --base-url or configure .firebaserc default project.");
    process.exit(1);
  }

  console.log(`Verifying deployed API: ${baseUrl}`);

  const healthResponse = await fetch(`${baseUrl}/health`);
  const healthBody = (await parseJsonResponse(healthResponse)) as { replicateToDrive?: boolean };
  if (!healthResponse.ok) {
    console.error("Health check failed:", healthResponse.status, healthBody);
    process.exit(1);
  }

  const replicateToDrive = Boolean(healthBody.replicateToDrive);
  const now = Date.now();
  const docA = `VERIFY-A-${now}`;
  const docB = `VERIFY-B-${now + 1}`;

  const scenarioAMetadataResponse = await fetch(`${baseUrl}/sap/metadata`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      documentId: docA,
      businessObjectType: "/SCMTMS/TOR",
      businessObjectId: "VERIFY-A-OBJECT",
      originalFileName: "verify-a.pdf",
      sourceSystem: "VERIFY",
      attributes: {
        torUuid: docA
      }
    })
  });
  const scenarioAMetadataBody = (await parseJsonResponse(scenarioAMetadataResponse)) as {
    replicatedToDrive?: boolean;
  };

  const scenarioAUploadResponse = await fetch(
    `${baseUrl}/sap/content/raw?documentId=${encodeURIComponent(docA)}&fileName=${encodeURIComponent("ignored-by-metadata.bin")}`,
    {
      method: "POST",
      headers: { "content-type": "application/pdf" },
      body: Buffer.from("VERIFY-A-PDF", "utf8")
    }
  );
  const scenarioAUploadBody = (await parseJsonResponse(scenarioAUploadResponse)) as {
    replicatedToDrive?: boolean;
  };

  const scenarioBUploadResponse = await fetch(
    `${baseUrl}/sap/content/raw?documentId=${encodeURIComponent(docB)}&fileName=${encodeURIComponent("upload-first.bin")}`,
    {
      method: "POST",
      headers: { "content-type": "application/pdf" },
      body: Buffer.from("VERIFY-B-PDF", "utf8")
    }
  );
  const scenarioBUploadBody = (await parseJsonResponse(scenarioBUploadResponse)) as {
    replicatedToDrive?: boolean;
  };

  const scenarioBMetadataResponse = await fetch(`${baseUrl}/sap/metadata`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      documentId: docB,
      businessObjectType: "/SCMTMS/TOR",
      businessObjectId: "VERIFY-B-OBJECT",
      originalFileName: "verify-b.pdf",
      sourceSystem: "VERIFY",
      attributes: {
        torUuid: docB
      }
    })
  });
  const scenarioBMetadataBody = (await parseJsonResponse(scenarioBMetadataResponse)) as {
    replicatedToDrive?: boolean;
  };

  const checks = [
    {
      label: "Health",
      passed: healthResponse.ok,
      details: { status: healthResponse.status, replicateToDrive }
    },
    {
      label: "A metadata-first metadata call",
      passed: scenarioAMetadataResponse.ok && Boolean(scenarioAMetadataBody.replicatedToDrive) === false,
      details: { status: scenarioAMetadataResponse.status, body: scenarioAMetadataBody }
    },
    {
      label: "A metadata-first upload call",
      passed:
        scenarioAUploadResponse.ok && Boolean(scenarioAUploadBody.replicatedToDrive) === (replicateToDrive ? true : false),
      details: { status: scenarioAUploadResponse.status, body: scenarioAUploadBody }
    },
    {
      label: "B upload-first upload call",
      passed: scenarioBUploadResponse.ok && Boolean(scenarioBUploadBody.replicatedToDrive) === false,
      details: { status: scenarioBUploadResponse.status, body: scenarioBUploadBody }
    },
    {
      label: "B upload-first metadata call",
      passed:
        scenarioBMetadataResponse.ok &&
        Boolean(scenarioBMetadataBody.replicatedToDrive) === (replicateToDrive ? true : false),
      details: { status: scenarioBMetadataResponse.status, body: scenarioBMetadataBody }
    }
  ];

  for (const check of checks) {
    console.log(`${check.passed ? "PASS" : "FAIL"} - ${check.label}`);
    if (!check.passed) {
      console.log(JSON.stringify(check.details));
    }
  }

  const failed = checks.filter((check) => !check.passed);
  if (failed.length > 0) {
    process.exit(1);
  }

  console.log("All deployed smoke checks passed.");
}

main().catch((error) => {
  console.error("Verification failed:", error);
  process.exit(1);
});
