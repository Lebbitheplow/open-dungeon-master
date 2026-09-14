import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Agent worktrees carry their own checkout and node_modules copy. Without
    // this, lint walks every one of them and reports thousands of problems
    // from dependencies rather than from this project's source.
    ".claude/**",
  ]),
  // The browser's own dialogs are drawn by the browser, not the table, and
  // the desktop shell does not implement every one of them. Ask through
  // src/components/ui/ConfirmDialog.tsx and PromptDialog.tsx instead.
  {
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    ignores: ["src/components/ui/ConfirmDialog.tsx"],
    rules: {
      "no-restricted-globals": ["error", "confirm", "alert", "prompt"],
      "no-restricted-properties": [
        "error",
        { object: "window", property: "confirm", message: "Use appConfirm from ConfirmDialog.tsx." },
        { object: "window", property: "alert", message: "Use appNotice from ConfirmDialog.tsx." },
        { object: "window", property: "prompt", message: "Use PromptDialog.tsx." },
      ],
    },
  },
]);

export default eslintConfig;
