import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/support/global-setup.ts"],
    // Integration tests truncate a single shared Postgres database between
    // tests — files must not run concurrently or they truncate each other.
    fileParallelism: false,
  },
});
