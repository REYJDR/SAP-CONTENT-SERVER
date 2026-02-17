import * as functions from "firebase-functions/v1";
import { app } from "./app";

export const api = functions
  .region("us-central1")
  .runWith({ timeoutSeconds: 120, memory: "512MB" })
  .https.onRequest(app);
