export interface DocumentRecord {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
  backend: "gcs" | "drive";
  attachmentSource?: string;
  storagePath?: string;
  driveFileId?: string;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
}

export interface PutDocumentInput {
  documentId: string;
  fileName: string;
  contentType: string;
  bytes: Buffer;
  attachmentSource?: string;
}

export interface PutDocumentFileInput {
  documentId: string;
  fileName: string;
  contentType: string;
  filePath: string;
  size: number;
  attachmentSource?: string;
}

export interface PutDocumentResult {
  storagePath?: string;
  driveFileId?: string;
  size: number;
}

export interface AttachmentBusinessMetadata {
  documentId: string;
  businessObjectType?: string;
  businessObjectId?: string;
  sourceLocation?: string;
  destinationLocation?: string;
  originalFileName?: string;
  sourceSystem?: string;
  attachmentSource?: string;
  attributes?: Record<string, string>;
  createdAt?: string;
  updatedAt?: string;
}
