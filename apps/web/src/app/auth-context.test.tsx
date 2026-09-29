import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AppProviders } from "./providers.js";
import { AppRouter } from "./router.js";

// A logged-out visitor's /auth/me answers 401 — exactly the state the login
// and register pages are shown in, so every request in this file gets that
// response. The short delay stands in for a real network round trip:
// answered instantly, Query folds "refetch started" and "refetch failed" into
// one batched update, the auth guard's loading state never renders, and a
// regression in that guard would slip through these tests unnoticed.
async function unauthenticated(): Promise<Response> {
  await new Promise((resolve) => setTimeout(resolve, 10));
  return new Response(
    JSON.stringify({ error: { code: "UNAUTHENTICATED", message: "Please sign in to continue." } }),
    { status: 401, headers: { "Content-Type": "application/json" } },
  );
}

// The real providers and router, composed the way main.tsx composes them —
// the bug these guard against lived in how the two interact (app-wide
// refetch-on-focus x the auth guard's loading spinner), not in either page.
function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppProviders>
        <AppRouter />
      </AppProviders>
    </MemoryRouter>,
  );
}

async function leaveAndReturnToTab() {
  await act(async () => {
    // What the browser fires on returning to the tab — TanStack Query's
    // focus manager listens for exactly this event on window.
    window.dispatchEvent(new Event("visibilitychange"));
    // Long enough for Query's batched notifications and the delayed fetch
    // above to settle, so a remount — if one happens — has already replaced
    // the fields before the assertions run.
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

// Plain `.value`, not jest-dom's toHaveValue: jest-dom is hoisted to the root
// node_modules, where its `vitest` import resolves the API workspace's older
// vitest, so its matchers never reach this workspace's `expect`.
function valueOf(label: string): string {
  return screen.getByLabelText<HTMLInputElement>(label).value;
}

describe("auth pages across a tab switch", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(unauthenticated));
  });

  afterEach(() => {
    // Explicit: with `globals: false` (vite.config.ts), Testing Library
    // can't register its automatic unmount between tests.
    cleanup();
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it("keeps a typed password on the login page", async () => {
    const user = userEvent.setup();
    renderAt("/login");

    await user.type(await screen.findByLabelText("Password"), "dhaka-tesla-demo");
    await leaveAndReturnToTab();

    expect(valueOf("Password")).toBe("dhaka-tesla-demo");
  });

  it("keeps every typed field on the register page", async () => {
    const user = userEvent.setup();
    renderAt("/register");

    await user.type(await screen.findByLabelText("Name"), "Shirin");
    await user.type(screen.getByLabelText("Email"), "shirin@dhakateslapool.test");
    await user.type(screen.getByLabelText("Password"), "dhaka-tesla-demo");
    await leaveAndReturnToTab();

    expect(valueOf("Name")).toBe("Shirin");
    expect(valueOf("Email")).toBe("shirin@dhakateslapool.test");
    expect(valueOf("Password")).toBe("dhaka-tesla-demo");
  });
});
