// Flat ESLint config for all TypeScript in the workspace.
// Generated code and build output are never linted.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/generated/**",
      "**/*.gen.*",
      "**/node_modules/**",
      "**/.turbo/**",
      // Playground project homes: generated app source, not repo code.
      "playground/.projects/**",
      "playground/.devtools/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
