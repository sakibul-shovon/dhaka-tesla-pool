import { desc, eq } from "drizzle-orm";
import type { Db, Tx } from "../../db/client.js";
import { wallets, walletTransactions } from "../../db/schema.js";
import { markLocked, type Locked } from "../../domain-writes/locked.js";
import type { LockOrderGuard } from "../../lib/lock-order.js";

// `undefined` means the user has never touched TeslaPay — treated as a
// ৳0 balance everywhere a caller reads it (plan §8.4: wallets are lazily
// created, not seeded for every user).
export async function findWalletBalance(db: Db | Tx, userId: string): Promise<number> {
  const [row] = await db.select({ balancePaisa: wallets.balancePaisa }).from(wallets).where(eq(wallets.userId, userId));
  return row?.balancePaisa ?? 0;
}

export type LockedWallet = Locked<{ userId: string; balancePaisa: number }>;

// Creates the wallet row on first use if it doesn't exist yet, then locks it
// — the insert-if-missing and the lock happen as one step so a concurrent
// first-use race can't create two rows for the same user (the primary key
// backstops that regardless).
export async function lockOrCreateWallet(tx: Tx, userId: string, guard: LockOrderGuard): Promise<LockedWallet> {
  guard.assert("wallet");
  await tx.insert(wallets).values({ userId }).onConflictDoNothing();
  const [row] = await tx
    .select({ userId: wallets.userId, balancePaisa: wallets.balancePaisa })
    .from(wallets)
    .where(eq(wallets.userId, userId))
    .for("update");
  return markLocked(row!);
}

export async function updateWalletBalance(tx: Tx, userId: string, balancePaisa: number): Promise<void> {
  await tx.update(wallets).set({ balancePaisa, updatedAt: new Date() }).where(eq(wallets.userId, userId));
}

export type WalletTransactionType = "TOPUP" | "DEBIT";

export async function insertWalletTransaction(
  tx: Tx,
  input: { walletUserId: string; type: WalletTransactionType; amountPaisa: number; rideRequestId?: string },
): Promise<void> {
  await tx.insert(walletTransactions).values({
    walletUserId: input.walletUserId,
    type: input.type,
    amountPaisa: input.amountPaisa,
    rideRequestId: input.rideRequestId ?? null,
  });
}

export interface WalletTransactionRow {
  id: string;
  type: WalletTransactionType;
  amountPaisa: number;
  rideRequestId: string | null;
  createdAt: Date;
}

export async function listWalletTransactions(db: Db, userId: string, limit: number): Promise<WalletTransactionRow[]> {
  return db
    .select({
      id: walletTransactions.id,
      type: walletTransactions.type,
      amountPaisa: walletTransactions.amountPaisa,
      rideRequestId: walletTransactions.rideRequestId,
      createdAt: walletTransactions.createdAt,
    })
    .from(walletTransactions)
    .where(eq(walletTransactions.walletUserId, userId))
    .orderBy(desc(walletTransactions.createdAt))
    .limit(limit);
}

export function toWalletTransactionDTO(row: WalletTransactionRow) {
  return {
    id: row.id,
    type: row.type,
    amountPaisa: row.amountPaisa,
    rideRequestId: row.rideRequestId,
    createdAt: row.createdAt.toISOString(),
  };
}
