import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["dist"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // The open app never reaches into the private server package (HOST-23): that package is not
      // a dependency here, and a relative path out of this folder would only work in the monorepo.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^@corrente/server|^(\\.\\./)+(packages/server|server/(api|db)|server/mcp/hosted)",
              message: "The open app cannot import the private server package (HOST-23).",
            },
          ],
        },
      ],
    },
  },
]);
