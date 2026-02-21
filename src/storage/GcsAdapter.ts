import { FirebaseStorageService } from "../services/firebaseStorageService";
import { PutDocumentFileInput, PutDocumentInput, PutDocumentResult } from "../types";
import { StorageAdapter } from "./StorageAdapter";

export class GcsAdapter implements StorageAdapter {
  private readonly firebaseStorageService = new FirebaseStorageService();

  async put(input: PutDocumentInput): Promise<PutDocumentResult> {
    const storagePath = await this.firebaseStorageService.upload(
      input.documentId,
      input.fileName,
      input.bytes,
      input.contentType,
      input.attachmentSource
    );

    return {
      storagePath,
      size: input.bytes.length
    };
  }

  async putFromFile(input: PutDocumentFileInput): Promise<PutDocumentResult> {
    const storagePath = await this.firebaseStorageService.uploadFromFile(
      input.documentId,
      input.fileName,
      input.filePath,
      input.contentType,
      input.attachmentSource
    );

    return {
      storagePath,
      size: input.size
    };
  }

  async get(documentId: string): Promise<{ bytes: Buffer; contentType: string; fileName: string } | null> {
    return this.firebaseStorageService.downloadByDocumentId(documentId);
  }

  async remove(documentId: string): Promise<void> {
    await this.firebaseStorageService.removeByDocumentId(documentId);
  }
}
