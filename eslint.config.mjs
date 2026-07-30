// Gate rationale in the repo issue tracker (#1501): tsc strict owns
// type errors; this config adds the promise-safety rules tsc cannot
// express plus the recommended baseline the codebase's existing
// eslint-disable comments were already written against. Import order
// is enforced here too (#1572): prettier-plugin-organize-imports
// no-ops silently under typescript 7.
import perfectionist from "eslint-plugin-perfectionist";
import tseslint from "typescript-eslint";

// No --cache in the script: type-aware rules depend on other files'
// types, which ESLint's per-file cache cannot invalidate. Scope is
// deliberately src + test only — the config files and build-scripts
// live outside tsconfig's include, so projectService cannot type them.
export default tseslint.config({
  files: ["src/**/*.ts", "test/**/*.ts"],
  extends: [...tseslint.configs.recommended],
  languageOptions: {
    parserOptions: {
      projectService: true,
      tsconfigRootDir: import.meta.dirname,
    },
  },
  plugins: {
    perfectionist,
  },
  rules: {
    // Side-effect imports hold their exact statement positions only
    // because sortSideEffects defaults false AND no side-effect group
    // is listed; partitionByNewLine keeps deliberate blank-line
    // paragraphs sorting internally only, and the two "ignore" newline
    // options are mandatory beside it (the rule throws otherwise).
    "perfectionist/sort-imports": [
      "error",
      {
        partitionByNewLine: true,
        newlinesBetween: "ignore",
        newlinesInside: "ignore",
        groups: [["builtin", "external"], ["parent", "sibling", "index"]],
      },
    ],
    "perfectionist/sort-named-imports": "error",
    // A variable read by a closure before its single assignment
    // cannot be a const; the option covers the pattern instead of
    // per-site disables.
    "prefer-const": ["error", { ignoreReadBeforeAssign: true }],
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
