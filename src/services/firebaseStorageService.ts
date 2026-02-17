import { storage } from "../firebase";
import { AttachmentBusinessMetadata } from "../types";

export interface FirebaseStoredFile {
  bytes: Buffer;
  contentType: string;
  fileName: string;
}

export class FirebaseStorageService {
  private readonly basePrefix = "sap-content";
  private readonly metadataPrefix = "sap-content-meta";

  getBucketName(): string {
    return storage.bucket().name;
  }

  private buildPath(documentId: string, sourceFolder?: string): string {
    if (sourceFolder) {
      return `${this.basePrefix}/${sourceFolder}/${documentId}`;
    }

    return `${this.basePrefix}/${documentId}`;
  }

  private buildMetadataPath(documentId: string): string {
    return `${this.metadataPrefix}/${documentId}.json`;
  }

  private async resolvePathByDocumentId(documentId: string): Promise<string | null> {
    const bucket = storage.bucket();
    const defaultPath = this.buildPath(documentId);
    const defaultFile = bucket.file(defaultPath);
    const [defaultExists] = await defaultFile.exists();
    if (defaultExists) {
      return defaultPath;
    }

    const [files] = await bucket.getFiles({ prefix: `${this.basePrefix}/` });
    const suffix = `/${documentId}`;
    const matched = files.find((file) => file.name.endsWith(suffix));

    return matched?.name || null;
  }

  async upload(
    documentId: string,
    fileName: string,
    bytes: Buffer,
    contentType: string,
    sourceFolder?: string
  ): Promise<string> {
    const bucket = storage.bucket();
    const storagePath = this.buildPath(documentId, sourceFolder);
    const file = bucket.file(storagePath);

    await file.save(bytes, {
      metadata: {
        contentType,
        metadata: {
          fileName,
          documentId,
          attachmentSource: sourceFolder || ""
        }
      }
    });

    return storagePath;
  }

  async download(storagePath: string): Promise<Buffer | null> {
    const bucket = storage.bucket();
    const file = bucket.file(storagePath);
    const [exists] = await file.exists();
    if (!exists) {
      return null;
    }

    const [bytes] = await file.download();
    return bytes;
  }

  async downloadByPath(storagePath: string): Promise<FirebaseStoredFile | null> {
    const bucket = storage.bucket();
    const file = bucket.file(storagePath);
    const [exists] = await file.exists();
    if (!exists) {
      return null;
    }

    const [metadata] = await file.getMetadata();
    const [bytes] = await file.download();
    const fileNameMeta = metadata.metadata?.fileName;
    const documentIdMeta = metadata.metadata?.documentId;
    const documentId = typeof documentIdMeta === "string" ? documentIdMeta : storagePath.split("/").pop() || "document";
    const fileName = typeof fileNameMeta === "string" ? fileNameMeta : `${documentId}.bin`;

    return {
      bytes,
      contentType: metadata.contentType || "application/octet-stream",
      fileName
    };
  }

  async downloadByDocumentId(documentId: string): Promise<FirebaseStoredFile | null> {
    const storagePath = await this.resolvePathByDocumentId(documentId);
    if (!storagePath) {
      return null;
    }

    return this.downloadByPath(storagePath);
  }

  async remove(storagePath: string): Promise<void> {
    const bucket = storage.bucket();
    const file = bucket.file(storagePath);
    const [exists] = await file.exists();
    if (!exists) {
      return;
    }

    await file.delete();
  }

  async removeByDocumentId(documentId: string): Promise<void> {
    const storagePath = await this.resolvePathByDocumentId(documentId);
    if (!storagePath) {
      return;
    }

    await this.remove(storagePath);
  }

  async upsertDocumentMetadata(
    documentId: string,
    input: Omit<AttachmentBusinessMetadata, "documentId" | "createdAt" | "updatedAt">
  ): Promise<AttachmentBusinessMetadata> {
    const bucket = storage.bucket();
    const metadataPath = this.buildMetadataPath(documentId);
    const file = bucket.file(metadataPath);

    const existing = await this.getDocumentMetadata(documentId);
    const nowIso = new Date().toISOString();
    const payload: AttachmentBusinessMetadata = {
      documentId,
      businessObjectType: input.businessObjectType,
      businessObjectId: input.businessObjectId,
      sourceLocation: input.sourceLocation,
      destinationLocation: input.destinationLocation,
      originalFileName: input.originalFileName,
      sourceSystem: input.sourceSystem,
      attachmentSource: input.attachmentSource,
      attributes: input.attributes,
      createdAt: existing?.createdAt || nowIso,
      updatedAt: nowIso
    };

    await file.save(JSON.stringify(payload), {
      metadata: {
        contentType: "application/json",
        metadata: {
          documentId
        }
      }
    });

    return payload;
  }

  async getDocumentMetadata(documentId: string): Promise<AttachmentBusinessMetadata | null> {
    const bucket = storage.bucket();
    const metadataPath = this.buildMetadataPath(documentId);
    const file = bucket.file(metadataPath);
    const [exists] = await file.exists();
    if (!exists) {
      return null;
    }

    const [bytes] = await file.download();
    try {
      const parsed = JSON.parse(bytes.toString("utf8")) as AttachmentBusinessMetadata;
      if (!parsed.documentId) {
        return { ...parsed, documentId };
      }

      return parsed;
    } catch {
      return null;
    }
  }
}
