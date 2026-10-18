import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";

// jsx-a11y's recommended set. eslint-config-next registers the plugin but
// turns on only six of its rules. The eight below still fail across the app
// (79 places in 48 files, the character builder among them, when this was
// added), so they wait for a pass of their own; every other recommended
// rule passes today and holds from here on.
const a11yRecommended = jsxA11y.flatConfigs.recommended.rules;
const a11yNotYetAppWide = [
  "jsx-a11y/no-autofocus",
  "jsx-a11y/label-has-associated-control",
  "jsx-a11y/aria-role",
  "jsx-a11y/no-noninteractive-element-interactions",
  "jsx-a11y/click-events-have-key-events",
  "jsx-a11y/no-noninteractive-tabindex",
  "jsx-a11y/no-static-element-interactions",
  "jsx-a11y/interactive-supports-focus",
];

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
  {
    files: ["src/**/*.tsx"],
    rules: Object.fromEntries(Object.entries(a11yRecommended).filter(([rule]) => !a11yNotYetAppWide.includes(rule))),
  },
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
