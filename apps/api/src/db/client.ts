import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import * as schema from "./schema.js";

export type Db = NodePgDatabase<typeof schema>;

// The transaction handle passed to every write path (plan §10.3, §10.7):
// derived from Db.transaction's own callback parameter so it always matches
// the driver's actual type, schema included.
export type Tx = Parameters<Db["transaction"]>[0] extends (tx: infer T) => unknown ? T : never;

export function createDb(pool: Pool): Db {
  return drizzle(pool, { schema });
}
