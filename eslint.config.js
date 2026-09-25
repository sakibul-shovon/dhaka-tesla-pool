// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";
import prettier from "eslint-config-prettier";

// Layer rules from docs/IMPLEMENTATION_PLAN.md §4.2: domain code stays pure
// (no DB, HTTP, env or clock); routes must not reach past use cases into
// repositories or raw SQL.
const domainMayNotImport = [
  { group: ["express", "pg", "pino*", "helmet"], message: "domain/ is pure — no DB, HTTP or logging imports." },
];

export default tseslint.config(
  {
    // .claude/, .githooks/ and scripts/git/ are the repo's guardrail
    // scripts from the planning phase (docs/GIT_WORKFLOW.md) — out of
    // scope for the app's lint config.
    ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**", ".claude/**", ".githooks/**", "scripts/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["apps/api/src/domain/**/*.ts"],
    plugins: { import: importPlugin },
    rules: {
      "no-restricted-imports": ["error", { patterns: domainMayNotImport }],
    },
  },
  {
    // health is an infra endpoint (liveness/readiness), not a domain
    // module — it legitimately queries the pool directly (plan §12.2).
    files: ["apps/api/src/modules/**/routes.ts", "apps/api/src/modules/**/routes/**/*.ts"],
    ignores: ["apps/api/src/modules/health/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [{ group: ["**/repositories/**", "pg"], message: "routes call use cases, not repositories or SQL directly." }],
        },
      ],
    },
  },
  {
    files: ["**/*.test.ts", "**/*.int.test.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // Plan §10.7: status columns change only through applyRideTransition /
    // applyPoolTransition in domain-writes/ — nowhere else may `.set()` a
    // `status` field, so a history row can never be forgotten.
    files: ["apps/api/src/**/*.ts"],
    ignores: ["apps/api/src/domain-writes/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='set'] ObjectExpression Property[key.name='status']",
          message:
            "Only domain-writes/ may set a status column directly — use applyRideTransition/applyPoolTransition (plan §10.7).",
        },
      ],
    },
  }
);
