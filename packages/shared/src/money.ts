// Money is integer BDT paisa end-to-end (plan §8.1, ADR-005) — never a
// float, so a mistyped `number` can't silently be treated as money.
declare const paisaBrand: unique symbol;
export type Paisa = number & { readonly [paisaBrand]: true };

export function paisa(amount: number): Paisa {
  if (!Number.isInteger(amount)) {
    throw new RangeError(`Paisa must be an integer, got ${amount}`);
  }
  return amount as Paisa;
}

export function formatPaisaAsTaka(amount: Paisa): string {
  return `৳${(amount / 100).toFixed(2)}`;
}
