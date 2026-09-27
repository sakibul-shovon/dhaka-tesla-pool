import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, Plus, Wallet as WalletIcon } from "lucide-react";
import { formatPaisaAsTaka, paisa } from "@dhaka-tesla-pool/shared";
import { api, ApiError, messageForError } from "../../lib/api-client.js";
import { isColdStart } from "../../lib/polling.js";
import type { WalletSummary, WalletTransaction } from "../../lib/types.js";
import { PageContainer } from "../../components/layout/PageContainer.js";
import { Card } from "../../components/ui/Card.js";
import { Button } from "../../components/ui/Button.js";
import { Input } from "../../components/ui/Input.js";
import { Modal } from "../../components/ui/Modal.js";
import { Skeleton } from "../../components/ui/Skeleton.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { ErrorBanner } from "../../components/ui/ErrorBanner.js";

const TOPUP_CAP_PAISA = 200_000; // ৳2,000 per call (backend-enforced; mirrored here so the form fails obviously, not silently)
const QUICK_AMOUNTS_PAISA = [10_000, 50_000, 100_000, 200_000];

function TopUpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [amountTaka, setAmountTaka] = useState("100");
  const amountPaisa = Math.round(Number(amountTaka) * 100);
  const isValidAmount =
    Number.isFinite(amountPaisa) && amountPaisa > 0 && amountPaisa <= TOPUP_CAP_PAISA;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const intentKey = useMemo(() => crypto.randomUUID(), [amountPaisa]);

  const topUp = useMutation({
    mutationFn: () => api.post("/wallet/topup", { amountPaisa }, intentKey),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["wallet"] });
      onClose();
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (isValidAmount) topUp.mutate();
  }

  return (
    <Modal open={open} onClose={onClose} title="Top up TeslaPay">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-4 gap-2">
          {QUICK_AMOUNTS_PAISA.map((amount) => (
            <button
              key={amount}
              type="button"
              onClick={() => setAmountTaka(String(amount / 100))}
              className={
                "rounded-lg border px-2 py-1.5 text-sm font-medium transition-colors " +
                (amountPaisa === amount
                  ? "border-accent bg-accent-soft text-accent-strong"
                  : "border-border-strong text-text-muted hover:text-text")
              }
            >
              ৳{amount / 100}
            </button>
          ))}
        </div>
        <div className="space-y-1.5">
          <label htmlFor="topup-amount" className="block text-sm font-medium text-text">
            Amount (৳)
          </label>
          <Input
            id="topup-amount"
            type="number"
            min={1}
            max={TOPUP_CAP_PAISA / 100}
            step="0.01"
            value={amountTaka}
            onChange={(event) => setAmountTaka(event.target.value)}
          />
          <p className="text-xs text-text-faint">Up to ৳{TOPUP_CAP_PAISA / 100} per top-up.</p>
        </div>
        {topUp.isError && (
          <ErrorBanner
            message={
              topUp.error instanceof ApiError
                ? messageForError(topUp.error.code, topUp.error.message)
                : "Something went wrong."
            }
          />
        )}
        <Button type="submit" disabled={!isValidAmount || topUp.isPending} className="w-full">
          {topUp.isPending ? "Adding funds…" : "Add funds"}
        </Button>
      </form>
    </Modal>
  );
}

function TransactionRow({ transaction }: { transaction: WalletTransaction }) {
  const isTopUp = transaction.type === "TOPUP";
  return (
    <li className="flex items-center gap-3 border-b border-border py-3 last:border-0">
      <span
        className={
          "flex h-8 w-8 flex-none items-center justify-center rounded-full " +
          (isTopUp ? "bg-success-soft text-success" : "bg-surface-raised text-text-muted")
        }
      >
        {isTopUp ? (
          <ArrowDownLeft size={15} strokeWidth={2.25} />
        ) : (
          <ArrowUpRight size={15} strokeWidth={2.25} />
        )}
      </span>
      <div className="flex-1">
        <p className="text-sm font-medium text-text">{isTopUp ? "Top-up" : "Ride payment"}</p>
        <p className="text-xs text-text-faint">
          {new Date(transaction.createdAt).toLocaleString()}
        </p>
      </div>
      <span className={"tabular text-sm font-semibold " + (isTopUp ? "text-success" : "text-text")}>
        {isTopUp ? "+" : "−"}
        {formatPaisaAsTaka(paisa(transaction.amountPaisa))}
      </span>
    </li>
  );
}

export function WalletPage() {
  const [topUpOpen, setTopUpOpen] = useState(false);

  const walletQuery = useQuery({
    queryKey: ["wallet"],
    queryFn: ({ signal }) => api.get<WalletSummary>("/wallet", signal),
  });
  const transactionsQuery = useQuery({
    queryKey: ["wallet", "transactions"],
    queryFn: ({ signal }) => api.get<WalletTransaction[]>("/wallet/transactions", signal),
  });

  if (walletQuery.isPending) {
    return (
      <PageContainer>
        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      </PageContainer>
    );
  }

  if (walletQuery.isError) {
    return (
      <PageContainer>
        <ErrorBanner
          message="We can't reach the server. Retry."
          coldStart={isColdStart(walletQuery as never)}
          onRetry={() => void walletQuery.refetch()}
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <h1 className="font-display text-2xl font-bold text-text">TeslaPay</h1>

      {/* Balance + top-up beside transactions on wide screens (plan round 3
          §3), stacked on mobile. */}
      <div className="mt-5 grid gap-6 lg:grid-cols-[320px_1fr] lg:items-start">
        <Card>
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-text-faint">
            <WalletIcon size={13} strokeWidth={2.5} />
            Balance
          </p>
          <p className="tabular mt-1 font-display text-4xl font-bold text-text">
            {formatPaisaAsTaka(paisa(walletQuery.data.balancePaisa))}
          </p>
          <Button
            onClick={() => setTopUpOpen(true)}
            icon={<Plus size={15} strokeWidth={2.5} />}
            className="mt-4 w-full"
          >
            Top up
          </Button>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold text-text">Recent activity</h2>
          {transactionsQuery.isPending ? (
            <Skeleton className="mt-3 h-24 rounded-lg" />
          ) : transactionsQuery.isError ? (
            <p className="mt-2 text-sm text-text-muted">Couldn't load transactions.</p>
          ) : transactionsQuery.data.length === 0 ? (
            <div className="mt-3">
              <EmptyState
                icon={WalletIcon}
                title="No activity yet"
                description="Top up or pay for a ride with TeslaPay to see it here."
              />
            </div>
          ) : (
            <ul className="mt-1">
              {transactionsQuery.data.map((transaction) => (
                <TransactionRow key={transaction.id} transaction={transaction} />
              ))}
            </ul>
          )}
        </Card>
      </div>

      <TopUpModal open={topUpOpen} onClose={() => setTopUpOpen(false)} />
    </PageContainer>
  );
}
