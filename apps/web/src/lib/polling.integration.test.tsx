import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createRefetchInterval } from "./polling.js";

interface RideLike {
  status: string;
}

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

// `vi.advanceTimersByTimeAsync` flushes microtasks as it advances fake
// timers, so it drives both the scheduled refetch *and* the promise the
// queryFn returns — RTL's own `waitFor` uses real timers internally and
// deadlocks against a faked clock, so it's deliberately not used here.
// Assertions land on total elapsed time rather than pinning an exact call
// count at every intermediate millisecond, since React Query re-derives
// `refetchInterval` on each render and a single big jump is less sensitive
// to exactly how many renders happen along the way than several small ones.
describe("createRefetchInterval wired to a real useQuery (RTL + fake timers)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls at the base interval, then stops once the result is terminal", async () => {
    let calls = 0;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });

    const { result } = renderHook(
      () =>
        useQuery<RideLike>({
          queryKey: ["ride"],
          queryFn: async () => {
            calls += 1;
            return calls < 3 ? { status: "REQUESTED" } : { status: "COMPLETED" };
          },
          refetchInterval: createRefetchInterval<RideLike>({
            baseMs: 3000,
            isTerminal: (data) => data.status === "COMPLETED",
          }),
        }),
      { wrapper: wrapper(queryClient) },
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(result.current.data).toEqual({ status: "REQUESTED" });
    expect(calls).toBe(1);

    // Enough time for both remaining polls (2 x 3s) to have fired and the
    // query to have reached its terminal state.
    await vi.advanceTimersByTimeAsync(7000);
    expect(result.current.data).toEqual({ status: "COMPLETED" });
    expect(calls).toBe(3);

    // Terminal now — a long further wait schedules no additional fetch.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls).toBe(3);
  });

  it("does not retry a failure immediately — the next attempt waits for the backed-off interval", async () => {
    let calls = 0;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(
      () =>
        useQuery<RideLike>({
          queryKey: ["flaky"],
          queryFn: async () => {
            calls += 1;
            if (calls === 1) {
              throw new Error("network blip");
            }
            return { status: "REQUESTED" };
          },
          refetchInterval: createRefetchInterval<RideLike>({
            baseMs: 3000,
            isTerminal: (data) => data.status === "COMPLETED",
          }),
        }),
      { wrapper: wrapper(queryClient) },
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(result.current.isError).toBe(true);
    expect(calls).toBe(1);

    // One failure -> next poll backs off to 2x base (6s); well before that,
    // at +3s (the un-backed-off base interval), nothing should have fired.
    await vi.advanceTimersByTimeAsync(3000);
    expect(calls).toBe(1);

    // Past the 6s backoff, the retry has happened and succeeded.
    await vi.advanceTimersByTimeAsync(4000);
    expect(result.current.data).toEqual({ status: "REQUESTED" });
    expect(calls).toBe(2);
  });
});
