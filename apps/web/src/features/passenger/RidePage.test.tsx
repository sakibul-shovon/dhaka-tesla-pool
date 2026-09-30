import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppProviders } from "../../app/providers.js";
import { AppRouter } from "../../app/router.js";

const RAFIQ = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Rafiq",
  email: "rafiq@dhakateslapool.test",
  role: "PASSENGER",
  status: "ACTIVE",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Rafiq is signed in and opens a link to a ride that isn't his. The API
// answers 404 for that (never 403 — a 403 would confirm the ride exists), so
// this is "not found", not "the server is down".
function stubApi() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/me")) return json(200, { data: RAFIQ });
      if (url.includes("/ride-requests/"))
        return json(404, { error: { code: "NOT_FOUND", message: "Not found." } });
      return json(200, { data: [] });
    }),
  );
}

describe("ride page for a ride the visitor does not own", () => {
  beforeEach(stubApi);

  afterEach(() => {
    // Explicit: with `globals: false` (vite.config.ts), Testing Library
    // can't register its automatic unmount between tests.
    cleanup();
    vi.unstubAllGlobals();
  });

  it("says the ride was not found, not that the server is waking up", async () => {
    render(
      <MemoryRouter initialEntries={["/p/rides/22222222-2222-4222-8222-222222222222"]}>
        <AppProviders>
          <AppRouter />
        </AppProviders>
      </MemoryRouter>,
    );

    expect(await screen.findByText("We couldn't find that ride.", {}, { timeout: 4000 })).toBeTruthy();
    expect(screen.queryByText(/Waking up the server/)).toBeNull();
    expect(screen.queryByText(/can't reach the server/)).toBeNull();
  });
});
