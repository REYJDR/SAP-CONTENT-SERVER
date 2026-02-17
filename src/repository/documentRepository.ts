import { firestore } from "../firebase";
import { DocumentRecord } from "../types";

const collection = firestore.collection("sapDocuments");

export async function upsertDocument(record: Omit<DocumentRecord, "createdAt" | "updatedAt">): Promise<void> {
  const ref = collection.doc(record.id);
  const existing = await ref.get();
  const now = new Date();

  await ref.set(
    {
      ...record,
      createdAt: existing.exists ? existing.get("createdAt") : now,
      updatedAt: now
    },
    { merge: true }
  );
}

export async function getDocument(documentId: string): Promise<DocumentRecord | null> {
  const snapshot = await collection.doc(documentId).get();
  if (!snapshot.exists) {
    return null;
  }

  return snapshot.data() as DocumentRecord;
}

export async function deleteDocument(documentId: string): Promise<void> {
  await collection.doc(documentId).delete();
}
