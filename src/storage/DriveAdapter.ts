import { createReadStream } from "fs";
import { Readable } from "stream";
import { env } from "../config/env";
import { getDocument } from "../repository/documentRepository";
import { buildDriveClient } from "../services/driveAuth";
import { PutDocumentFileInput, PutDocumentInput, PutDocumentResult } from "../types";
import { StorageAdapter } from "./StorageAdapter";

export class DriveAdapter implements StorageAdapter {
  private drive = buildDriveClient();

  async put(input: PutDocumentInput): Promise<PutDocumentResult> {
    if (!env.GOOGLE_DRIVE_FOLDER_ID) {
      throw new Error("GOOGLE_DRIVE_FOLDER_ID is required for drive backend");
    }

    const response = await this.drive.files.create({
      requestBody: {
        name: `${input.documentId}__${input.fileName}`,
        mimeType: input.contentType,
        parents: [env.GOOGLE_DRIVE_FOLDER_ID]
      },
      media: {
        mimeType: input.contentType,
        body: Readable.from(input.bytes)
      },
      fields: "id",
      supportsAllDrives: true
    });

    const driveFileId = response.data.id;
    if (!driveFileId) {
      throw new Error("Failed to create file on Google Drive");
    }

    return {
      driveFileId,
      size: input.bytes.length
    };
  }

  async putFromFile(input: PutDocumentFileInput): Promise<PutDocumentResult> {
    if (!env.GOOGLE_DRIVE_FOLDER_ID) {
      throw new Error("GOOGLE_DRIVE_FOLDER_ID is required for drive backend");
    }

    const response = await this.drive.files.create({
      requestBody: {
        name: `${input.documentId}__${input.fileName}`,
        mimeType: input.contentType,
        parents: [env.GOOGLE_DRIVE_FOLDER_ID]
      },
      media: {
        mimeType: input.contentType,
        body: createReadStream(input.filePath)
      },
      fields: "id",
      supportsAllDrives: true
    });

    const driveFileId = response.data.id;
    if (!driveFileId) {
      throw new Error("Failed to create file on Google Drive");
    }

    return {
      driveFileId,
      size: input.size
    };
  }

  async get(documentId: string): Promise<{ bytes: Buffer; contentType: string; fileName: string } | null> {
    const meta = await getDocument(documentId);
    if (!meta?.driveFileId) {
      return null;
    }

    const fileResponse = await this.drive.files.get(
      {
        fileId: meta.driveFileId,
        alt: "media",
        supportsAllDrives: true
      },
      { responseType: "arraybuffer" }
    );

    const bytes = Buffer.from(fileResponse.data as ArrayBuffer);

    return {
      bytes,
      contentType: meta.contentType,
      fileName: meta.fileName
    };
  }

  async remove(documentId: string): Promise<void> {
    const meta = await getDocument(documentId);
    if (!meta?.driveFileId) {
      return;
    }

    await this.drive.files.delete({ fileId: meta.driveFileId, supportsAllDrives: true });
  }
}
