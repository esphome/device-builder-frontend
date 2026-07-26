// Gate rationale in the repo issue tracker (#1501): tsc strict owns
// type errors; this config adds the promise-safety rules tsc cannot
// express plus the recommended baseline the codebase's existing
// eslint-disable comments were already written against.
import tseslint from "typescript-eslint";

export default tseslint.config({
  files: ["src/**/*.ts", "test/**/*.ts"],
  extends: [...tseslint.configs.recommended],
  languageOptions: {
    parserOptions: {
      projectService: true,
      tsconfigRootDir: import.meta.dirname,
    },
  },
  rules: {
    "@typescript-eslint/no-floating-promises": "error",
    // inheritedMethods off: Lit's async lifecycle overrides
    // (connectedCallback et al.) are idiomatic; the base class never
    // consumes the return value.
    "@typescript-eslint/no-misused-promises": [
      "error",
      { checksVoidReturn: { inheritedMethods: false } },
    ],
    // Mirrors home-assistant/frontend: underscore names opt out, the
    // same convention the tsc gate's noUnusedLocals already follows.
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        args: "all",
        argsIgnorePattern: "^_",
        caughtErrors: "all",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        ignoreRestSiblings: true,
      },
    ],
  },
});
