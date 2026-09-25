import type { Db, Tx } from "../db/client.js";

// The one entry point every write path uses (plan §10.3). Deliberately thin
// for this session: lock/statement timeouts and bounded retry on deadlock
// (40P01) / serialization (40001) failures land in feature/concurrency-safety,
// wrapping this same function so call sites do not change.
export function runInTransaction<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}
