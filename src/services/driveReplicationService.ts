import { Readable } from "stream";
import { env } from "../config/env";
import { getRuntimeAppConfig } from "../config/runtimeConfig";
import { buildDriveClient } from "./driveAuth";

function assertFolderId(): string {
  const runtimeAppConfig = getRuntimeAppConfig();
  const folderId = runtimeAppConfig.google_drive_folder_id || env.GOOGLE_DRIVE_FOLDER_ID;

  if (!folderId) {
    throw new Error("GOOGLE_DRIVE_FOLDER_ID is required when REPLICATE_TO_DRIVE=true");
  }

  return folderId;
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/'/g, "\\'");
}

function normalizeFolderName(value: string): string {
  return value.trim().replace(/\/+$/g, "") || "unknown";
}

function normalizeLocationSegment(value?: string): string {
  if (!value) {
    return "unknown";
  }

  const normalized = value.trim();
  return normalized || "unknown";
}

function buildFoObjectFolderName(
  businessObjectId: string,
  sourceLocation?: string,
  destinationLocation?: string
): string {
  const source = normalizeLocationSegment(sourceLocation);
  const destination = normalizeLocationSegment(destinationLocation);
  return `${businessObjectId} (${source} - ${destination})`;
}

export class DriveReplicationService {
  private readonly drive = buildDriveClient();

  private async ensureChildFolder(parentId: string, folderName: string): Promise<string> {
    const escapedName = escapeDriveQueryValue(folderName);

    const listed = await this.drive.files.list({
      q: `'${parentId}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder' and name = '${escapedName}'`,
      fields: "files(id,name)",
      pageSize: 10,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });

    const existing = listed.data.files?.find((file) => Boolean(file.id));
    if (existing?.id) {
      return existing.id;
    }

    const created = await this.drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentId]
      },
      fields: "id",
      supportsAllDrives: true
    });

    if (!created.data.id) {
      throw new Error(`Failed to create Drive folder: ${folderName}`);
    }

    return created.data.id;
  }

  getConfiguredFolderId(): string {
    return assertFolderId();
  }

  async diagnoseFolder(): Promise<{
    runtimeFolderId?: string;
    envFolderId?: string;
    folderId: string;
    folderName?: string;
    mimeType?: string;
    driveId?: string;
    canAddChildren?: boolean;
    canEdit?: boolean;
    effectiveAuthEmail?: string;
  }> {
    const runtimeAppConfig = getRuntimeAppConfig();
    const folderId = assertFolderId();

    const [folderResponse, aboutResponse] = await Promise.all([
      this.drive.files.get({
        fileId: folderId,
        supportsAllDrives: true,
        fields: "id,name,mimeType,driveId,capabilities(canAddChildren,canEdit)"
      }),
      this.drive.about.get({ fields: "user(emailAddress)" })
    ]);

    const folder = folderResponse.data;
    const user = aboutResponse.data.user;

    return {
      runtimeFolderId: runtimeAppConfig.google_drive_folder_id || undefined,
      envFolderId: env.GOOGLE_DRIVE_FOLDER_ID || undefined,
      folderId,
      folderName: folder.name || undefined,
      mimeType: folder.mimeType || undefined,
      driveId: folder.driveId || undefined,
      canAddChildren: folder.capabilities?.canAddChildren,
      canEdit: folder.capabilities?.canEdit,
      effectiveAuthEmail: user?.emailAddress || undefined
    };
  }

  async replicate(
    documentId: string,
    fileName: string,
    contentType: string,
    bytes: Buffer,
    options: {
      businessObjectType: string;
      businessObjectId: string;
      sourceLocation?: string;
      destinationLocation?: string;
    }
  ): Promise<string> {
    const rootFolderId = assertFolderId();
    const businessObjectTypeFolder = normalizeFolderName(options.businessObjectType);
    const businessObjectIdFolder = normalizeFolderName(
      buildFoObjectFolderName(options.businessObjectId, options.sourceLocation, options.destinationLocation)
    );

    const typeFolderId = await this.ensureChildFolder(rootFolderId, businessObjectTypeFolder);
    const objectFolderId = await this.ensureChildFolder(typeFolderId, businessObjectIdFolder);
    const attachmentFolderId = await this.ensureChildFolder(objectFolderId, "Attachment");

    await this.deleteReplicas(documentId);

    const response = await this.drive.files.create({
      requestBody: {
        name: fileName,
        mimeType: contentType,
        parents: [attachmentFolderId],
        appProperties: {
          documentId,
          businessObjectType: options.businessObjectType,
          businessObjectId: options.businessObjectId,
          sourceLocation: options.sourceLocation || "",
          destinationLocation: options.destinationLocation || ""
        }
      },
      media: {
        mimeType: contentType,
        body: Readable.from(bytes)
      },
      fields: "id",
      supportsAllDrives: true
    });

    const driveFileId = response.data.id;
    if (!driveFileId) {
      throw new Error("Failed to create replicated file on Google Drive");
    }

    return driveFileId;
  }

  async deleteReplicas(documentId: string): Promise<number> {
    const escapedDocumentId = escapeDriveQueryValue(documentId);

    const listed = await this.drive.files.list({
      q: `trashed = false and appProperties has { key='documentId' and value='${escapedDocumentId}' }`,
      fields: "files(id)",
      pageSize: 100,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });

    const files = listed.data.files || [];
    for (const file of files) {
      if (file.id) {
        await this.drive.files.delete({ fileId: file.id, supportsAllDrives: true });
      }
    }

    return files.length;
  }
}
