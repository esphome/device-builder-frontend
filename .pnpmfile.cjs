// typescript-eslint drives the TS 6 JS API; the repo's own `typescript`
// is the TS 7 native port whose API it cannot load:
// https://github.com/typescript-eslint/typescript-eslint/issues/10940
// Give the typescript-eslint packages a private TS 6 dependency so the
// fast TS 7 `tsc --noEmit` gate and the type-aware lint coexist.
//
// Consequences to keep in mind:
// - Lint evaluates the codebase under TS ~6.0.3 while the build and
//   the `lint` gate use the package.json `typescript` pin; a TS 7-only
//   construct can surface as an ESLint-only parse/type error.
// - The pin below is disconnected from package.json and nothing warns
//   on drift (the peer dependency is deleted on purpose).
// eslint-plugin-perfectionist has the same gap: sort-imports probes
// require("typescript") for isExternalModuleNameRelative, which the
// TS 7 native port does not export; module resolution walks up past
// the virtual store to the repo's TS 7, so the require succeeds and
// the call crashes instead of hitting the plugin's no-typescript
// fallback. Same private TS 6 pin until the plugin guards the probe.
//
// DELETE THIS WHOLE FILE once both pins are obsolete: typescript-eslint
// supporting the TS 7 API, and perfectionist guarding its probe.
// NOTE: any edit to this file (comments included) changes the
// pnpmfileChecksum pnpm stamps into the lockfile; run `pnpm install`
// afterwards or --frozen-lockfile installs fail.
function readPackage(pkg) {
  if (
    pkg.name === "typescript-eslint" ||
    pkg.name?.startsWith("@typescript-eslint/") ||
    pkg.name === "eslint-plugin-perfectionist"
  ) {
    if (pkg.peerDependencies?.typescript) delete pkg.peerDependencies.typescript;
    pkg.dependencies = { ...pkg.dependencies, typescript: "~6.0.3" };
  }
  return pkg;
}
module.exports = { hooks: { readPackage } };
