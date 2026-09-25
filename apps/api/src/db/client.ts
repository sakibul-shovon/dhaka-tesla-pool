import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import * as schema from "./schema.js";

export type Db = NodePgDatabase<typeof schema>;

export function createDb(pool: Pool): Db {
  return drizzle(pool, { schema });
}
