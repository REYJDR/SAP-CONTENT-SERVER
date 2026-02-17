import admin from "firebase-admin";
import { env } from "./config/env";

const runtimeProjectId = env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
const runtimeStorageBucket = env.FIREBASE_STORAGE_BUCKET || (runtimeProjectId ? `${runtimeProjectId}.firebasestorage.app` : undefined);

const hasInlineServiceAccount =
  Boolean(env.FIREBASE_PROJECT_ID) &&
  Boolean(env.FIREBASE_CLIENT_EMAIL) &&
  Boolean(env.FIREBASE_PRIVATE_KEY);

if (admin.apps.length === 0) {
  if (hasInlineServiceAccount) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: env.FIREBASE_PROJECT_ID,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        privateKey: env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n")
      }),
      storageBucket: runtimeStorageBucket
    });
  } else {
    admin.initializeApp({
      storageBucket: runtimeStorageBucket
    });
  }
}

export const firestore = admin.firestore();
export const storage = admin.storage();
