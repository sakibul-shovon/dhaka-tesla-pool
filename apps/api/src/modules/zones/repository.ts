import { asc } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { zones } from "../../db/schema.js";

const ZONE_COLUMNS = {
  code: zones.code,
  name: zones.name,
  xDkm: zones.xDkm,
  yDkm: zones.yDkm,
} as const;

export async function listZones(db: Db): Promise<Array<{ code: string; name: string; xDkm: number; yDkm: number }>> {
  return db.select(ZONE_COLUMNS).from(zones).orderBy(asc(zones.code));
}
