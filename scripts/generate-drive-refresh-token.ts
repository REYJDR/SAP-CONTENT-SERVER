import readline from "node:readline";
import { google } from "googleapis";

const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error("Missing GOOGLE_DRIVE_CLIENT_ID or GOOGLE_DRIVE_CLIENT_SECRET in environment.");
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(clientId, clientSecret, "urn:ietf:wg:oauth:2.0:oob");

const authUrl = oauth2.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: ["https://www.googleapis.com/auth/drive"]
});

console.log("Open this URL in your browser and authorize access:\n");
console.log(authUrl);
console.log("\nPaste the authorization code here:");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question("> ", async (code) => {
  try {
    const tokenResponse = await oauth2.getToken(code.trim());
    const refreshToken = tokenResponse.tokens.refresh_token;

    if (!refreshToken) {
      console.error("No refresh token returned. Re-run and ensure prompt=consent is granted.");
      process.exitCode = 1;
      return;
    }

    console.log("\nGOOGLE_DRIVE_REFRESH_TOKEN=");
    console.log(refreshToken);
  } catch (error) {
    console.error("Failed to exchange code for tokens:", error);
    process.exitCode = 1;
  } finally {
    rl.close();
  }
});
