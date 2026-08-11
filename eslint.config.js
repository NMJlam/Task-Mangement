import js from "@eslint/js";
import importPlugin from "eslint-plugin-import";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/drizzle/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/coverage/**",
      "**/*.config.{js,ts}",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Shared rules for all TypeScript.
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { import: importPlugin },
    rules: {
      // TS handles undefined-symbol detection; the core rule false-positives on types.
      "no-undef": "off",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "import/order": [
        "warn",
        {
          alphabetize: { order: "asc", caseInsensitive: true },
          "newlines-between": "never",
          groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='defaultRandom']",
          message: "Generate UUIDv7 IDs with backend/src/db/id.ts newId().",
        },
      ],
    },
  },

  // §1.2: shared/ is types only — no framework, runtime, or db imports.
  {
    files: ["shared/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "react",
                "react-dom",
                "express",
                "drizzle-orm",
                "drizzle-orm/*",
                "pg",
                "@neondatabase/serverless",
                "@ctp/frontend",
                "@ctp/backend",
                "**/frontend/**",
                "**/backend/**",
              ],
              message:
                "shared/ must contain only zod schemas + inferred types — no framework, runtime, or db imports (§1.2 / §6).",
            },
          ],
        },
      ],
    },
  },

  // §1.2: frontend/ never imports backend/.
  {
    files: ["frontend/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks, "jsx-a11y": jsxA11y },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@ctp/backend", "**/backend/**"],
              message:
                "frontend/ must never import backend/. Communicate over HTTP; share types via @ctp/shared (§1.2).",
            },
          ],
        },
      ],
    },
  },

  // §1.2: backend/ never imports frontend/.
  {
    files: ["backend/**/*.ts"],
    languageOptions: { globals: globals.node },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@ctp/frontend", "**/frontend/**"],
              message: "backend/ must never import frontend/ (§1.2).",
            },
          ],
        },
      ],
    },
  },

  // Tests get both global sets and can use `any`-ish test doubles loosely.
  {
    files: ["**/*.test.{ts,tsx}"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
