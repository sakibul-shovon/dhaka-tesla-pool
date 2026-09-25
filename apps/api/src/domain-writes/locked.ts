// A stale, unlocked read can't be passed into a transition function by
// accident (plan §10.7): `Locked<T>` is a type-only brand, produced only by
// the repository functions that actually run `SELECT ... FOR UPDATE`.
declare const lockedBrand: unique symbol;
export type Locked<T> = T & { readonly [lockedBrand]: true };

// The one place allowed to mint the brand — call this immediately next to
// the locking query, never further away from it.
export function markLocked<T>(row: T): Locked<T> {
  return row as Locked<T>;
}
