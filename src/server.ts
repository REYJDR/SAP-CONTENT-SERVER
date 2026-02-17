import { env } from "./config/env";
import { app } from "./app";

app.listen(env.PORT, () => {
  console.log(`SAP content server listening on port ${env.PORT}`);
});
