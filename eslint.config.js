import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      ".copy-check-*/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,ts,tsx}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    // React Compilerは導入していないため、Hookの呼び出し順序と依存配列を検査します。
    rules: {
      "react-hooks/rules-of-hooks": "error",
      // SSRで切り替えるlayout/passive effectにも、通常のeffectと同じ依存検査を適用します。
      "react-hooks/exhaustive-deps": [
        "error",
        { additionalHooks: "useCommitEffect" },
      ],
    },
  },
  // 整形はPrettierへ集約し、ESLintの整形ルールとの衝突を防ぎます。
  prettier,
);
