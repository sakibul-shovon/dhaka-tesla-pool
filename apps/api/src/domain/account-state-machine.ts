// Account status (ADR-019). Same table-as-data shape as the ride and pool
// state machines, so the unit test can walk every pair. The enum itself
// (users.status) has existed since migration 0000 and auth already rejects
// anything but ACTIVE — this only decides which admin commands are legal.
export const ACCOUNT_STATUSES = ["ACTIVE", "SUSPENDED"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const ACCOUNT_COMMANDS = ["suspend", "reactivate"] as const;
export type AccountCommand = (typeof ACCOUNT_COMMANDS)[number];

export type AccountTransitionResult =
  | { readonly allowed: true; readonly to: AccountStatus }
  | { readonly allowed: false; readonly error: "INVALID_TRANSITION" };

const TRANSITION_TABLE: Record<AccountStatus, Partial<Record<AccountCommand, AccountStatus>>> = {
  ACTIVE: { suspend: "SUSPENDED" },
  SUSPENDED: { reactivate: "ACTIVE" },
};

export function accountTransition(
  current: AccountStatus,
  command: AccountCommand,
): AccountTransitionResult {
  const to = TRANSITION_TABLE[current][command];
  if (to === undefined) {
    return { allowed: false, error: "INVALID_TRANSITION" };
  }
  return { allowed: true, to };
}

// Admins are never suspendable from the panel: no self-lock-out, and no one
// admin silently disabling another (plan §13.1 threat model).
export const SUSPENDABLE_ROLES = ["PASSENGER", "DRIVER"] as const;

export function isSuspendableRole(role: string): boolean {
  return (SUSPENDABLE_ROLES as readonly string[]).includes(role);
}
