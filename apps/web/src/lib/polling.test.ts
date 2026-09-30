import { describe, expect, it, vi } from "vitest";
import type { Query } from "@tanstack/react-query";
import { createRefetchInterval, isColdStart, POLL_BASE_MS } from "./polling.js";

interface RideLike {
  status: string;
}

function fakeQuery<T>(overrides: {
  data?: T;
  fetchFailureCount?: number;
  dataUpdateCount?: number;
}): Query<T> {
  return {
    state: {
      data: overrides.data,
      fetchFailureCount: overrides.fetchFailureCount ?? 0,
      dataUpdateCount: overrides.dataUpdateCount ?? 1,
    },
  } as unknown as Query<T>;
}

const isRideTerminal = (data: RideLike): boolean => data.status === "COMPLETED" || data.status === "CANCELLED";

describe("createRefetchInterval (plan §15.4)", () => {
  const interval = createRefetchInterval<RideLike>({ baseMs: POLL_BASE_MS.activeRide, isTerminal: isRideTerminal });

  it("uses the base interval with no failures", () => {
    expect(interval(fakeQuery({ data: { status: "REQUESTED" } }))).toBe(3000);
  });

  it("doubles the interval on each consecutive failure, capped at 30s", () => {
    expect(interval(fakeQuery({ data: { status: "REQUESTED" }, fetchFailureCount: 1 }))).toBe(6000);
    expect(interval(fakeQuery({ data: { status: "REQUESTED" }, fetchFailureCount: 2 }))).toBe(12_000);
    expect(interval(fakeQuery({ data: { status: "REQUESTED" }, fetchFailureCount: 3 }))).toBe(24_000);
    expect(interval(fakeQuery({ data: { status: "REQUESTED" }, fetchFailureCount: 4 }))).toBe(30_000);
    expect(interval(fakeQuery({ data: { status: "REQUESTED" }, fetchFailureCount: 10 }))).toBe(30_000);
  });

  it("stops polling once the ride is terminal", () => {
    expect(interval(fakeQuery({ data: { status: "COMPLETED" } }))).toBe(false);
    expect(interval(fakeQuery({ data: { status: "CANCELLED" } }))).toBe(false);
  });

  it("keeps polling for every non-terminal status", () => {
    for (const status of ["REQUESTED", "MATCHED", "DRIVER_ARRIVED", "STARTED"]) {
      expect(interval(fakeQuery({ data: { status } }))).toBe(3000);
    }
  });

  it("polls before any data has arrived yet", () => {
    expect(interval(fakeQuery<RideLike>({ data: undefined, fetchFailureCount: 0 }))).toBe(3000);
  });

  it("stops polling when the browser reports offline", () => {
    const spy = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    try {
      expect(interval(fakeQuery({ data: { status: "REQUESTED" } }))).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});

// The shape screens actually pass: the object `useQuery` returns, not a
// `Query` — `dataUpdatedAt` is 0 until the first success.
function fakeResult(overrides: { dataUpdatedAt: number; failureCount: number }) {
  return overrides;
}

describe("isColdStart", () => {
  it("is true only when nothing has ever succeeded and at least one fetch failed", () => {
    expect(isColdStart(fakeResult({ dataUpdatedAt: 0, failureCount: 1 }))).toBe(true);
  });

  it("is false before any failure", () => {
    expect(isColdStart(fakeResult({ dataUpdatedAt: 0, failureCount: 0 }))).toBe(false);
  });

  it("is false once the query has succeeded at least once, even if it later fails", () => {
    expect(isColdStart(fakeResult({ dataUpdatedAt: 1_700_000_000_000, failureCount: 1 }))).toBe(false);
  });
});
