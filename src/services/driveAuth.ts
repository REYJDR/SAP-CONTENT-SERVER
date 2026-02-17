import { google } from "googleapis";
import { env } from "../config/env";
import { getRuntimeAppConfig } from "../config/runtimeConfig";

type DriveOAuthConfig = {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
};

function getDriveOAuthConfig(): DriveOAuthConfig {
  const runtimeAppConfig = getRuntimeAppConfig();

  return {
    clientId: env.GOOGLE_DRIVE_CLIENT_ID || runtimeAppConfig.google_drive_client_id,
    clientSecret: env.GOOGLE_DRIVE_CLIENT_SECRET || runtimeAppConfig.google_drive_client_secret,
    refreshToken: env.GOOGLE_DRIVE_REFRESH_TOKEN || runtimeAppConfig.google_drive_refresh_token
  };
}

export function buildDriveClient() {
  const oauth = getDriveOAuthConfig();

  if (oauth.clientId && oauth.clientSecret && oauth.refreshToken) {
    const oauth2 = new google.auth.OAuth2(oauth.clientId, oauth.clientSecret);
    oauth2.setCredentials({ refresh_token: oauth.refreshToken });
    return google.drive({ version: "v3", auth: oauth2 });
  }

  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/drive"]
  });

  return google.drive({ version: "v3", auth });
}
