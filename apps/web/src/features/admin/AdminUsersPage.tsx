import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Search, Users as UsersIcon } from "lucide-react";
import { api } from "../../lib/api-client.js";
import { isColdStart } from "../../lib/polling.js";
import type { AccountSummary } from "../../lib/types.js";
import { PageContainer } from "../../components/layout/PageContainer.js";
import { Card } from "../../components/ui/Card.js";
import { Badge } from "../../components/ui/Badge.js";
import { Input } from "../../components/ui/Input.js";
import { Skeleton } from "../../components/ui/Skeleton.js";
import { ErrorBanner } from "../../components/ui/ErrorBanner.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { accountStatusTone, roleTone } from "./adminDisplay.js";

const ROLE_FILTERS = [
  { value: undefined, label: "All roles" },
  { value: "PASSENGER", label: "Passengers" },
  { value: "DRIVER", label: "Drivers" },
  { value: "ADMIN", label: "Admins" },
] as const;

const STATUS_FILTERS = [
  { value: undefined, label: "All statuses" },
  { value: "ACTIVE", label: "Active" },
  { value: "SUSPENDED", label: "Suspended" },
] as const;

export function AdminUsersPage() {
  const [role, setRole] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>([]);

  const query = useQuery({
    queryKey: ["admin", "users", role, status, q, cursor],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ limit: "20" });
      if (role) params.set("role", role);
      if (status) params.set("status", status);
      if (q.trim()) params.set("q", q.trim());
      if (cursor) params.set("cursor", cursor);
      return api.getPage<AccountSummary>(`/admin/users?${params.toString()}`, signal);
    },
  });

  function resetPaging() {
    setCursor(null);
    setCursorStack([]);
  }

  return (
    <PageContainer>
      <h1 className="font-display text-2xl font-bold text-text">Users</h1>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {ROLE_FILTERS.map((filter) => (
            <button
              key={filter.label}
              type="button"
              onClick={() => {
                setRole(filter.value);
                resetPaging();
              }}
              className={
                "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors " +
                (role === filter.value
                  ? "border-accent bg-accent-soft text-accent-strong"
                  : "border-border-strong text-text-muted hover:text-text")
              }
            >
              {filter.label}
            </button>
          ))}
          <span className="mx-1 hidden w-px self-stretch bg-border sm:block" aria-hidden />
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.label}
              type="button"
              onClick={() => {
                setStatus(filter.value);
                resetPaging();
              }}
              className={
                "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors " +
                (status === filter.value
                  ? "border-accent bg-accent-soft text-accent-strong"
                  : "border-border-strong text-text-muted hover:text-text")
              }
            >
              {filter.label}
            </button>
          ))}
        </div>
        <div className="relative sm:w-64">
          <Search
            size={15}
            strokeWidth={2.25}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-faint"
          />
          <Input
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
              resetPaging();
            }}
            placeholder="Search name or email"
            className="pl-9"
          />
        </div>
      </div>

      <div className="mt-5">
        {query.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-14 rounded-xl" />
            <Skeleton className="h-14 rounded-xl" />
          </div>
        ) : query.isError ? (
          <ErrorBanner
            message="We can't reach the server. Retry."
            coldStart={isColdStart(query)}
            onRetry={() => void query.refetch()}
          />
        ) : query.data.data.length === 0 ? (
          <EmptyState
            icon={UsersIcon}
            title="No users match"
            description="Try a different filter or search."
          />
        ) : (
          <>
            <div className="hidden overflow-hidden rounded-2xl border border-border sm:block">
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-6 border-b border-border bg-surface-raised px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-text-faint">
                <span>Name</span>
                <span>Role</span>
                <span>Status</span>
                <span>Joined</span>
              </div>
              <div className="divide-y divide-border bg-surface">
                {query.data.data.map((account) => (
                  <Link
                    key={account.id}
                    to={`/a/users/${account.id}`}
                    className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-6 px-4 py-3 text-sm transition-colors hover:bg-surface-raised"
                  >
                    <span>
                      <span className="block font-medium text-text">{account.name}</span>
                      <span className="block text-xs text-text-faint">{account.email}</span>
                    </span>
                    <Badge tone={roleTone(account.role)}>{account.role.toLowerCase()}</Badge>
                    <Badge tone={accountStatusTone(account.status)}>
                      {account.status.toLowerCase()}
                    </Badge>
                    <span className="text-text-muted">
                      {new Date(account.createdAt).toLocaleDateString()}
                    </span>
                  </Link>
                ))}
              </div>
            </div>

            <ul className="space-y-2 sm:hidden">
              {query.data.data.map((account) => (
                <li key={account.id}>
                  <Link to={`/a/users/${account.id}`}>
                    <Card className="transition-[color,background-color,border-color,box-shadow,transform] hover:border-border-strong hover:shadow-md motion-safe:hover:-translate-y-0.5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-text">{account.name}</span>
                        <Badge tone={accountStatusTone(account.status)}>
                          {account.status.toLowerCase()}
                        </Badge>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between">
                        <span className="text-xs text-text-faint">{account.email}</span>
                        <Badge tone={roleTone(account.role)}>{account.role.toLowerCase()}</Badge>
                      </div>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}

        {query.data && query.data.data.length > 0 && (
          <div className="mt-4 flex justify-between">
            <button
              type="button"
              disabled={cursorStack.length === 0}
              onClick={() => {
                const stack = [...cursorStack];
                const previous = stack.pop() ?? null;
                setCursorStack(stack);
                setCursor(previous);
              }}
              className="flex items-center gap-1 text-sm text-text-muted transition-colors hover:text-text disabled:opacity-40"
            >
              <ChevronLeft size={15} strokeWidth={2.25} />
              Newer
            </button>
            <button
              type="button"
              disabled={!query.data.page.nextCursor}
              onClick={() => {
                if (cursor) setCursorStack([...cursorStack, cursor]);
                setCursor(query.data.page.nextCursor);
              }}
              className="flex items-center gap-1 text-sm text-text-muted transition-colors hover:text-text disabled:opacity-40"
            >
              Older
              <ChevronRight size={15} strokeWidth={2.25} />
            </button>
          </div>
        )}
      </div>
    </PageContainer>
  );
}
