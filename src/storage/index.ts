import { env } from "../config/env";
import { DriveAdapter } from "./DriveAdapter";
import { GcsAdapter } from "./GcsAdapter";
import { StorageAdapter } from "./StorageAdapter";

export function createStorageAdapter(): StorageAdapter {
  if (env.STORAGE_BACKEND === "drive") {
    return new DriveAdapter();
  }

  return new GcsAdapter();
}
