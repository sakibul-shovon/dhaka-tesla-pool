import path from "node:path";
import { config } from "dotenv";

// npm workspace scripts run with cwd set to the workspace folder, not the
// repo root where .env lives — INIT_CWD is npm's own record of where
// `npm run` was actually invoked from, so this finds .env regardless of
// which workspace's script loads it. A no-op if the file doesn't exist
// (Docker/CI inject real env vars directly and need no .env at all).
config({ path: path.join(process.env.INIT_CWD ?? process.cwd(), ".env") });
