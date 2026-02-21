import { env } from "../config/env";
import { StorageAdapter } from "./StorageAdapter";

export function createStorageAdapter(): StorageAdapter {
  if (env.STORAGE_BACKEND === "drive") {
    const { DriveAdapter } = require("./DriveAdapter") as typeof import("./DriveAdapter");
    return new DriveAdapter();
  }

  const { GcsAdapter } = require("./GcsAdapter") as typeof import("./GcsAdapter");
  return new GcsAdapter();
}
