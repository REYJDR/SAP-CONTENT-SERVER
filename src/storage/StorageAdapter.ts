import { PutDocumentFileInput, PutDocumentInput, PutDocumentResult } from "../types";

export interface StorageAdapter {
  put(input: PutDocumentInput): Promise<PutDocumentResult>;
  putFromFile(input: PutDocumentFileInput): Promise<PutDocumentResult>;
  get(documentId: string): Promise<{ bytes: Buffer; contentType: string; fileName: string } | null>;
  remove(documentId: string): Promise<void>;
}
