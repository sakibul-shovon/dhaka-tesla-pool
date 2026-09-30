import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppProviders } from "./providers.js";
import { AppRouter } from "./router.js";

const NUSRAT = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Nusrat",
  email: "nusrat@dhakateslapool.test",
  role: "PASSENGER",
  status: "ACTIVE",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Nusrat is signed in, but the API behind the passenger home screen fails
// with a 500 — what a free-tier database that is still waking up produces.
function stubApiDown() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/auth/me")) return json(200, { data: NUSRAT });
      return json(500, { error: { code: "INTERNAL_ERROR", message: "Unexpected error." } });
    }),
  );
}

describe("a screen whose data fails to load", () => {
  beforeEach(stubApiDown);

  afterEach(() => {
    // Explicit: with `globals: false` (vite.config.ts), Testing Library
    // can't register its automatic unmount between tests.
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the waking-up banner with Retry instead of rendering a blank page", async () => {
    render(
      <MemoryRouter initialEntries={["/p"]}>
        <AppProviders>
          <AppRouter />
        </AppProviders>
      </MemoryRouter>,
    );

    // Query's one automatic retry waits about a second before the error
    // state is reached, hence the longer timeout.
    expect(await screen.findByText(/Waking up the server/, {}, { timeout: 4000 })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
